import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';
import { emailVerificationEmail } from '@/lib/mail/email-verification';
import { readUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';
import { claimGuestDonations } from '@/lib/guest-donation-claim';
import { publicUrl } from '@/lib/public-url';

/**
 * An account proves it owns its email address by opening a link sent to it
 * (prd-compliance 23). Only then may it claim a Guest Donor's history under
 * that address (src/lib/guest-donation-claim.ts).
 *
 * Why it is shaped this way:
 *
 * - **The request is for the signed-in account's own address**, read from its
 *   own row. There is no field to type an address into, so the endpoint cannot
 *   be aimed at someone else's inbox, and it cannot be used to ask whether an
 *   address has history: the answer to "send me a link" is the same whether or
 *   not any guest Donation matches.
 * - **The token is random, stored as a SHA-256, one-use and short-lived.** A
 *   dump of the table holds nothing that can be replayed.
 * - **A token confirms the address it was issued for.** It carries the
 *   account's email HMAC at issue time; if the address changed since, it no
 *   longer confirms anything.
 * - **A cooldown per account** stands in for a rate limiter (PR #161's
 *   src/lib/rate-limit.ts is not merged and this does not depend on it), the
 *   same way the Receipt resend route does.
 */

const TOKEN_BYTES = 32;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_COOLDOWN_MS = 60_000;

export type RequestEmailVerificationResult =
  | { status: 'sent' }
  | { status: 'already-verified' }
  | { status: 'too-soon' }
  | { status: 'send-failed' }
  | { status: 'not-found' };

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function requestEmailVerification(
  userId: string,
  now: Date = new Date(),
): Promise<RequestEmailVerificationResult> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, emailHmac: true, emailVerifiedAt: true, ...SELECT_USER_EMAIL },
  });
  if (!account) return { status: 'not-found' };
  if (account.emailVerifiedAt) return { status: 'already-verified' };

  const latest = await prisma.emailVerificationToken.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < EMAIL_VERIFICATION_COOLDOWN_MS) {
    return { status: 'too-soon' };
  }

  const to = readUserEmail(account);
  if (!to) return { status: 'send-failed' };

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const row = await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      emailHmac: account.emailHmac,
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    },
    select: { id: true },
  });

  const delivered = await sendReportingFailure(
    emailVerificationEmail({
      to,
      name: account.name,
      confirmUrl: publicUrl(`/akun/verifikasi-email?token=${token}`),
    }),
    { mail: 'email_verification', userId },
  );
  if (!delivered) {
    // A message that never left must not burn the cooldown, nor leave a live
    // token nobody holds.
    await prisma.emailVerificationToken.delete({ where: { id: row.id } });
    return { status: 'send-failed' };
  }
  return { status: 'sent' };
}

export type ConfirmEmailVerificationResult = { ok: true; claimed: number } | { ok: false };

/**
 * Spends a token. Every refusal is the same `{ ok: false }` -- unknown,
 * spent, expired, or issued for an address the account no longer has -- so a
 * caller learns nothing by guessing.
 */
export async function confirmEmailVerification(
  token: string,
  now: Date = new Date(),
): Promise<ConfirmEmailVerificationResult> {
  if (!token) return { ok: false };

  const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return { ok: false };

  const account = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { id: true, emailHmac: true },
  });
  if (!account || account.emailHmac !== row.emailHmac) return { ok: false };

  // The where is the lock: of two concurrent opens of one link, one updates a
  // row and the other updates none.
  const spent = await prisma.emailVerificationToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  if (spent.count !== 1) return { ok: false };

  await prisma.user.update({ where: { id: account.id }, data: { emailVerifiedAt: now } });
  const { claimed } = await claimGuestDonations(account.id);
  return { ok: true, claimed };
}
