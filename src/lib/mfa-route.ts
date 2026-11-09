import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getServerSession } from "@/lib/auth";
import { mintMfaProof } from "@/lib/mfa-proof";

/**
 * What the account MFA routes share (pks-pemenuhan/03): who is calling, the
 * proof a successful check hands back, and one mapping from a refusal to HTTP.
 * These routes are deliberately NOT behind withAssignmentCheck: the person who
 * must use them is exactly the one whose session carries no authority yet.
 */

type Caller = { userId: string; sid: string; email: string };

export async function mfaCaller(): Promise<{ caller: Caller } | { response: NextResponse }> {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { caller: { userId, sid: "", email: session.user.email ?? userId } };
}

/** The caller, with the session id the cookie carries, for routes that mint a proof. */
export async function mfaCallerWithSession(
  req: NextRequest,
): Promise<{ caller: Caller } | { response: NextResponse }> {
  const found = await mfaCaller();
  if ("response" in found) return found;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  // A cookie from before this feature has no session id until the browser has
  // fetched /api/auth/session once; a proof cannot be bound without one.
  if (!token || token.id !== found.caller.userId || typeof token.sid !== "string") {
    return {
      response: NextResponse.json(
        { error: "Sesi perlu dimuat ulang. Muat ulang halaman lalu coba lagi.", code: "SESSION_STALE" },
        { status: 409 },
      ),
    };
  }
  return { caller: { ...found.caller, sid: token.sid } };
}

export function proofFor(caller: Caller, enabledAt: Date): string {
  return mintMfaProof({ userId: caller.userId, sid: caller.sid, enabledAtMs: enabledAt.getTime() }, Date.now());
}

export async function readCode(req: NextRequest): Promise<string | null> {
  const body = await req.json().catch(() => null);
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.trim() !== "" && code.length <= 64 ? code : null;
}

export type MfaRefusal = {
  reason: "invalid" | "limited" | "locked" | "unavailable" | "not_enrolled" | "no_pending" | "already_enrolled";
  retryAfterSeconds?: number;
};

export function refusalResponse(refusal: MfaRefusal): NextResponse {
  switch (refusal.reason) {
    case "invalid":
      return NextResponse.json({ error: "Kode salah atau sudah dipakai." }, { status: 400 });
    case "limited":
      return NextResponse.json(
        { error: "Terlalu banyak percobaan. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(refusal.retryAfterSeconds ?? 300) } },
      );
    case "locked":
      return NextResponse.json(
        {
          error:
            "Terlalu banyak percobaan gagal hari ini, jadi verifikasi dikunci. Coba lagi setelah 24 jam, atau minta Admin lain mereset autentikasi dua faktor Anda.",
        },
        { status: 429, headers: { "Retry-After": String(refusal.retryAfterSeconds ?? 86400) } },
      );
    case "unavailable":
      return NextResponse.json(
        { error: "Layanan sedang tidak dapat memeriksa kode. Coba lagi nanti." },
        { status: 503 },
      );
    case "not_enrolled":
      return NextResponse.json({ error: "Autentikasi dua faktor belum didaftarkan." }, { status: 409 });
    case "no_pending":
      return NextResponse.json({ error: "Tidak ada pendaftaran yang menunggu konfirmasi. Mulai dari awal." }, { status: 409 });
    case "already_enrolled":
      return NextResponse.json(
        { error: "Autentikasi dua faktor sudah aktif. Minta Admin lain mereset jika perangkat hilang." },
        { status: 409 },
      );
  }
}

export const badCode = () => NextResponse.json({ error: "Kode wajib diisi." }, { status: 400 });
