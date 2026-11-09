import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { requireFieldKeys } from "@/lib/contact-fields";
import { PASSWORD_HASH_COST } from "@/lib/password-hash-cost";
import { hashPassword, verifyPassword } from "@/lib/password-hash";
import { notifyMfaChange } from "@/lib/notifications";
import { checkRateLimit } from "@/lib/rate-limit-guard";
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";

/**
 * The TOTP second factor for ADMIN and VERIFIER holders (ticket
 * pks-pemenuhan/03, contract Pasal 8(1)): enrolment, the code check, backup
 * codes and the Admin reset. Every rule lives here; the routes only parse and
 * map a refusal to HTTP, as ./assignments.ts does.
 *
 * - The secret is sealed with the field-encryption scheme (ADR 0012).
 * - A TOTP code is good once: `lastUsedStep` only moves forward, through a
 *   conditional UPDATE, so two simultaneous submissions cannot both win.
 * - A backup code is good once: `usedAt` is set by a conditional UPDATE.
 * - Attempts are counted per person before anything is looked at, and the
 *   limiter fails CLOSED: if it is down, nobody gets in on a guess.
 */

export const ISSUER = "Fund for Indonesia";
const BACKUP_CODE_COUNT = 10;
const SECRET_FIELD = "UserMfa.secret";

const VERIFY_LIMIT = { scope: "mfa-verify", limit: 5, windowSeconds: 5 * 60 } as const;
const ENROLL_LIMIT = { scope: "mfa-enroll", limit: 10, windowSeconds: 5 * 60 } as const;
/**
 * The cumulative cap on top of the 5-minute limit: 5 guesses per 5 minutes is
 * 1440 a day, far too many against a 6-digit code. Past this the person is
 * "locked" until the window passes or another Admin resets the factor. No
 * schema change: it is the same fixed-window counter with a longer window.
 */
const VERIFY_DAILY_LIMIT = { scope: "mfa-verify-daily", limit: 20, windowSeconds: 24 * 60 * 60 } as const;
const SETUP_LIMIT = { scope: "mfa-setup", limit: 5, windowSeconds: 60 * 60 } as const;

export type Refusal = "invalid" | "limited" | "locked" | "unavailable";

function normaliseBackupCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toLowerCase();
}

function isTotpShaped(raw: string): boolean {
  return /^\d{6}$/.test(raw.replace(/\s/g, ""));
}

function isBackupShaped(normalised: string): boolean {
  return /^[a-z2-7]{10}$/.test(normalised);
}

/** Ten codes, 50 bits each, shown as `abcde-fghij`. The hash is over the form without the dash. */
function newBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(normaliseBackupCode(code), PASSWORD_HASH_COST)));
}

async function limited(
  scope: { scope: string; limit: number; windowSeconds: number },
  userId: string,
  limitedAs: "limited" | "locked" = "limited",
) {
  const verdict = await checkRateLimit({ ...scope, subject: userId, onUnavailable: "closed" });
  if (verdict.ok) return null;
  return verdict.reason === "limited"
    ? ({ ok: false, reason: limitedAs, retryAfterSeconds: verdict.retryAfterSeconds } as const)
    : ({ ok: false, reason: "unavailable" } as const);
}

/**
 * Tells the account holder, after the commit, that their second factor changed.
 * Best-effort: a failure here is logged by class and never undoes or blocks the change.
 */
async function tellAccountHolder(prisma: PrismaClient, userId: string, kind: "enabled" | "backup_codes_regenerated") {
  try {
    await notifyMfaChange(prisma, { userId, kind });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "mfa_notify_failed", kind, error: error instanceof Error ? error.name : "UnknownError" }),
    );
  }
}

export async function getMfaStatus(prisma: PrismaClient, userId: string) {
  const row = await prisma.userMfa.findUnique({ where: { userId }, select: { enabledAt: true } });
  const backupCodesRemaining = await prisma.mfaBackupCode.count({ where: { userId, usedAt: null } });
  return {
    enrolled: !!row?.enabledAt,
    pending: !!row && !row.enabledAt,
    enabledAt: row?.enabledAt ?? null,
    backupCodesRemaining,
  };
}

/**
 * Starts (or restarts) enrolment: a fresh secret, not yet in force. Refused once
 * enrolled, so a stolen password cannot swap the factor for the attacker's.
 */
export async function beginEnrollment(
  prisma: PrismaClient,
  params: { userId: string; account: string },
): Promise<
  | { ok: true; secret: string; uri: string }
  | { ok: false; reason: Refusal | "already_enrolled"; retryAfterSeconds?: number }
> {
  const blocked = await limited(SETUP_LIMIT, params.userId);
  if (blocked) return blocked;

  const existing = await prisma.userMfa.findUnique({ where: { userId: params.userId }, select: { enabledAt: true } });
  if (existing?.enabledAt) return { ok: false, reason: "already_enrolled" };

  const secret = generateTotpSecret();
  const sealed = requireFieldKeys().encrypt(SECRET_FIELD, secret);
  const data = { secretCiphertext: sealed.ciphertext, secretKeyId: sealed.keyId, enabledAt: null, lastUsedStep: 0 };
  await prisma.userMfa.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...data },
    update: data,
  });
  return { ok: true, secret, uri: otpauthUri({ secret, account: params.account, issuer: ISSUER }) };
}

function openSecret(row: { secretCiphertext: string; secretKeyId: string }): string {
  return requireFieldKeys().decrypt(SECRET_FIELD, { ciphertext: row.secretCiphertext, keyId: row.secretKeyId });
}

/** Confirms enrolment with a first code and issues the ten backup codes, shown once. */
export async function confirmEnrollment(
  prisma: PrismaClient,
  params: { userId: string; code: string; now: number },
): Promise<
  | { ok: true; backupCodes: string[]; enabledAt: Date }
  | { ok: false; reason: Refusal | "no_pending"; retryAfterSeconds?: number }
> {
  const blocked = await limited(ENROLL_LIMIT, params.userId);
  if (blocked) return blocked;

  const row = await prisma.userMfa.findUnique({ where: { userId: params.userId } });
  if (!row || row.enabledAt) return { ok: false, reason: "no_pending" };

  const step = verifyTotp(openSecret(row), params.code, params.now);
  if (step === null) return { ok: false, reason: "invalid" };

  const backupCodes = newBackupCodes();
  const hashes = await hashBackupCodes(backupCodes);
  const enabledAt = new Date(params.now);

  const won = await prisma.$transaction(async (tx) => {
    const claimed = await tx.userMfa.updateMany({
      where: { userId: params.userId, enabledAt: null },
      data: { enabledAt, lastUsedStep: step },
    });
    if (claimed.count !== 1) return false;
    await tx.mfaBackupCode.deleteMany({ where: { userId: params.userId } });
    await tx.mfaBackupCode.createMany({ data: hashes.map((codeHash) => ({ userId: params.userId, codeHash })) });
    await tx.mfaAuditEntry.create({ data: { userId: params.userId, actedById: params.userId, action: "ENROLLED" } });
    return true;
  });
  if (!won) return { ok: false, reason: "no_pending" };
  await tellAccountHolder(prisma, params.userId, "enabled");
  return { ok: true, backupCodes, enabledAt };
}

/**
 * Checks a TOTP or (unless `allowBackup` is false) a backup code for an
 * enrolled person. Returns the enrolment the code proved, which the caller
 * turns into a session proof (./mfa-proof.ts).
 */
export async function verifySecondFactor(
  prisma: PrismaClient,
  params: { userId: string; code: string; now: number; allowBackup?: boolean },
): Promise<
  | { ok: true; enabledAt: Date }
  | { ok: false; reason: Refusal | "not_enrolled"; retryAfterSeconds?: number }
> {
  const blocked = await limited(VERIFY_LIMIT, params.userId);
  if (blocked) return blocked;
  const locked = await limited(VERIFY_DAILY_LIMIT, params.userId, "locked");
  if (locked) return locked;

  const row = await prisma.userMfa.findUnique({ where: { userId: params.userId } });
  if (!row?.enabledAt) return { ok: false, reason: "not_enrolled" };
  const enabledAt = row.enabledAt;

  if (isTotpShaped(params.code)) {
    const step = verifyTotp(openSecret(row), params.code, params.now);
    if (step === null) return { ok: false, reason: "invalid" };
    // The code is spent only if its step is newer than any already accepted.
    const spent = await prisma.userMfa.updateMany({
      where: { userId: params.userId, enabledAt: { not: null }, lastUsedStep: { lt: step } },
      data: { lastUsedStep: step },
    });
    return spent.count === 1 ? { ok: true, enabledAt } : { ok: false, reason: "invalid" };
  }

  const candidate = normaliseBackupCode(params.code);
  if (params.allowBackup === false || !isBackupShaped(candidate)) return { ok: false, reason: "invalid" };

  const unused = await prisma.mfaBackupCode.findMany({ where: { userId: params.userId, usedAt: null } });
  for (const stored of unused) {
    if (!(await verifyPassword(candidate, stored.codeHash))) continue;
    const spent = await prisma.mfaBackupCode.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date(params.now) },
    });
    if (spent.count !== 1) return { ok: false, reason: "invalid" };
    await prisma.mfaAuditEntry.create({
      data: { userId: params.userId, actedById: params.userId, action: "BACKUP_CODE_USED" },
    });
    return { ok: true, enabledAt };
  }
  return { ok: false, reason: "invalid" };
}

/** New backup codes, replacing the old. Needs a valid TOTP code (a backup code cannot mint more). */
export async function regenerateBackupCodes(
  prisma: PrismaClient,
  params: { userId: string; code: string; now: number },
): Promise<
  | { ok: true; backupCodes: string[] }
  | { ok: false; reason: Refusal | "not_enrolled"; retryAfterSeconds?: number }
> {
  const checked = await verifySecondFactor(prisma, { ...params, allowBackup: false });
  if (!checked.ok) return checked;

  const backupCodes = newBackupCodes();
  const hashes = await hashBackupCodes(backupCodes);
  await prisma.$transaction(async (tx) => {
    await tx.mfaBackupCode.deleteMany({ where: { userId: params.userId } });
    await tx.mfaBackupCode.createMany({ data: hashes.map((codeHash) => ({ userId: params.userId, codeHash })) });
    await tx.mfaAuditEntry.create({
      data: { userId: params.userId, actedById: params.userId, action: "BACKUP_CODES_REGENERATED" },
    });
  });
  await tellAccountHolder(prisma, params.userId, "backup_codes_regenerated");
  return { ok: true, backupCodes };
}

/**
 * Another Admin removes a person's factor (lost phone). Never one's own: a
 * session that could reset its own factor would make the factor pointless, and
 * the audit entry is meant to show a second person acting.
 */
export async function resetMfa(
  prisma: PrismaClient,
  params: { userId: string; actedById: string; reason: string },
): Promise<{ ok: true } | { ok: false; reason: "self" | "not_enrolled" | "reason_required" }> {
  if (params.userId === params.actedById) return { ok: false, reason: "self" };
  const reason = params.reason.trim().slice(0, 500);
  if (!reason) return { ok: false, reason: "reason_required" };
  const removed = await prisma.$transaction(async (tx) => {
    const gone = await tx.userMfa.deleteMany({ where: { userId: params.userId } });
    if (gone.count === 0) return false;
    await tx.mfaBackupCode.deleteMany({ where: { userId: params.userId } });
    await tx.mfaAuditEntry.create({
      data: { userId: params.userId, actedById: params.actedById, action: "RESET", reason },
    });
    return true;
  });
  return removed ? { ok: true } : { ok: false, reason: "not_enrolled" };
}
