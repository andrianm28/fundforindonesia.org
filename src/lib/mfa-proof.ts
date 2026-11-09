import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * How a session learns it has passed the second factor (pks-pemenuhan/03).
 *
 * next-auth v4 keeps the session in a JWT cookie that only its own callbacks
 * can rewrite, and the client can call `update(data)` with anything. So the
 * client is never believed: the API route that actually checked the code
 * returns this short-lived proof, an HMAC over (user, session id, enrolment,
 * expiry) under a key derived from NEXTAUTH_SECRET, and the jwt callback accepts it only if the
 * MAC verifies and the user and session id match the token it is rewriting.
 * A proof minted for one session therefore cannot be used in another.
 */

const PROOF_TTL_MS = 2 * 60 * 1000;

type Claim = { userId: string; sid: string };

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("NEXTAUTH_SECRET is not set: cannot sign an MFA proof");
  return value;
}

/** The MAC key is derived (HKDF-SHA256, info "ffi-mfa-proof"), so NEXTAUTH_SECRET itself never keys this HMAC. */
function proofKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", secret(), Buffer.alloc(0), "ffi-mfa-proof", 32));
}

function sign(payload: string): Buffer {
  return createHmac("sha256", proofKey()).update(`mfa-proof|${payload}`).digest();
}

export function mintMfaProof(params: Claim & { enabledAtMs: number }, now: number): string {
  const payload = Buffer.from(
    JSON.stringify({ u: params.userId, s: params.sid, e: params.enabledAtMs, x: now + PROOF_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}

/** The `enabledAtMs` the proof was minted for, or null for anything not valid right now for this session. */
export function readMfaProof(proof: unknown, claim: Claim, now: number): number | null {
  if (typeof proof !== "string") return null;
  const parts = proof.split(".");
  if (parts.length !== 2) return null;
  const [payload, mac] = parts;
  try {
    const given = Buffer.from(mac, "base64url");
    const expected = sign(payload);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      s?: unknown;
      e?: unknown;
      x?: unknown;
    };
    if (body.u !== claim.userId || body.s !== claim.sid) return null;
    if (typeof body.x !== "number" || body.x <= now) return null;
    return typeof body.e === "number" ? body.e : null;
  } catch {
    return null;
  }
}
