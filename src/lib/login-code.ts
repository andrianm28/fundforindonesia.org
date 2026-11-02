import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';
import { loginCodeEmail } from '@/lib/mail/login-code';
import { lookupUserEmail, readUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';

/**
 * Sign-in by a one-time code mailed to the account's address (login OTP).
 *
 * Why it is shaped this way:
 *
 * - **Only a keyed HMAC of the code is stored.** A 6-digit code has a million
 *   values, so a plain SHA-256 in a dump would fall to a loop in a second. The
 *   key is derived from NEXTAUTH_SECRET under its own domain, as the password
 *   reset token's is, and the account id is in the MAC, so one account's code
 *   says nothing about another's.
 * - **One-use, short-lived, few guesses.** A code lives
 *   {@link LOGIN_CODE_TTL_MS}, dies after {@link LOGIN_CODE_MAX_ATTEMPTS} wrong
 *   guesses, and is spent by a conditional update, so of two concurrent
 *   sign-ins with one code exactly one wins. Issuing a new code retires every
 *   older unused one, so only the latest mail works.
 * - **Bound to the address it was mailed to.** The code carries the account's
 *   email HMAC at issue; if the address changed since, it signs nobody in.
 * - **It proves the address.** A code typed back is the same proof the
 *   confirmation link gives, so a successful sign-in sets `emailVerifiedAt`
 *   when empty (the third writer; ADR 0020 names the other two).
 * - **Every refusal is the same `null`.** Unknown address, no code, wrong,
 *   expired, used up or stale all look alike to the caller.
 *
 * Rate limits per client and per address live in the routes and in the
 * NextAuth provider; the cooldown here is per account, as in
 * src/lib/email-verification.ts. Server-only.
 */

export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_COOLDOWN_MS = 60_000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_LENGTH = 6;

const CODE_DOMAIN = 'fund-for-indonesia:login-code:v1';
const CODE_PATTERN = new RegExp(`^\\d{${LOGIN_CODE_LENGTH}}$`);

let ephemeralSecret: string | undefined;

function resolveSecret(secret?: string): string {
  const configured = secret ?? process.env.NEXTAUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('NEXTAUTH_SECRET is not set');
  ephemeralSecret ??= randomBytes(32).toString('hex');
  return ephemeralSecret;
}

export function hashLoginCode(userId: string, code: string, secret?: string): string {
  const key = createHmac('sha256', resolveSecret(secret)).update(CODE_DOMAIN).digest();
  return createHmac('sha256', key).update(`${userId}:${code}`).digest('hex');
}

/** Digits only: a code pasted as "123 456" or with a trailing newline still counts. */
export function normaliseLoginCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const digits = input.replace(/\s+/g, '');
  return CODE_PATTERN.test(digits) ? digits : null;
}

export type IssueLoginCodeResult =
  | { status: 'sent' }
  | { status: 'no-account' }
  | { status: 'too-soon' }
  | { status: 'send-failed' };

export async function issueLoginCode(email: string, now: Date = new Date(), secret?: string): Promise<IssueLoginCodeResult> {
  const account = await prisma.user.findFirst({
    where: lookupUserEmail(email),
    select: { id: true, name: true, emailHmac: true, ...SELECT_USER_EMAIL },
  });
  if (!account) return { status: 'no-account' };

  const latest = await prisma.loginCode.findFirst({
    where: { userId: account.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < LOGIN_CODE_COOLDOWN_MS) {
    return { status: 'too-soon' };
  }

  const to = readUserEmail(account);
  if (!to) return { status: 'send-failed' };

  const code = String(randomInt(0, 10 ** LOGIN_CODE_LENGTH)).padStart(LOGIN_CODE_LENGTH, '0');
  const row = await prisma.$transaction(async (tx) => {
    await tx.loginCode.updateMany({ where: { userId: account.id, usedAt: null }, data: { usedAt: now } });
    return tx.loginCode.create({
      data: {
        userId: account.id,
        codeHash: hashLoginCode(account.id, code, secret),
        emailHmac: account.emailHmac,
        expiresAt: new Date(now.getTime() + LOGIN_CODE_TTL_MS),
      },
      select: { id: true },
    });
  });

  const delivered = await sendReportingFailure(
    loginCodeEmail({ to, name: account.name, code, ttlMinutes: LOGIN_CODE_TTL_MS / 60_000 }),
    { mail: 'login_code', userId: account.id },
  );
  if (!delivered) {
    // A code nobody received must not burn the cooldown.
    await prisma.loginCode.delete({ where: { id: row.id } });
    return { status: 'send-failed' };
  }
  return { status: 'sent' };
}

export type LoginCodeUser = { id: string; email: string; name: string; image: string | null };

class Refused extends Error {}

export async function verifyLoginCode(
  email: string,
  input: unknown,
  now: Date = new Date(),
  secret?: string,
): Promise<LoginCodeUser | null> {
  const code = normaliseLoginCode(input);
  if (!code || typeof email !== 'string' || email.trim() === '') return null;

  const account = await prisma.user.findFirst({
    where: lookupUserEmail(email),
    select: { id: true, name: true, avatar: true, emailHmac: true, ...SELECT_USER_EMAIL },
  });
  if (!account) return null;

  const row = await prisma.loginCode.findFirst({
    where: { userId: account.id, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (
    !row ||
    row.expiresAt.getTime() <= now.getTime() ||
    row.attempts >= LOGIN_CODE_MAX_ATTEMPTS ||
    row.emailHmac !== account.emailHmac
  ) {
    return null;
  }

  const expected = Buffer.from(row.codeHash, 'hex');
  const given = Buffer.from(hashLoginCode(account.id, code, secret), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await prisma.loginCode.updateMany({ where: { id: row.id, usedAt: null }, data: { attempts: { increment: 1 } } });
    return null;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const spent = await tx.loginCode.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: LOGIN_CODE_MAX_ATTEMPTS } },
        data: { usedAt: now },
      });
      if (spent.count !== 1) throw new Refused();
      await tx.user.updateMany({
        where: { id: account.id, emailHmac: row.emailHmac, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
    });
  } catch (error) {
    if (error instanceof Refused) return null;
    throw error;
  }

  const address = readUserEmail(account);
  if (!address) return null;
  return { id: account.id, email: address, name: account.name, image: account.avatar ?? null };
}
