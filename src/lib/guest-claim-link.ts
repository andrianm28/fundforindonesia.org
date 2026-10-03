import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';
import { guestClaimEmail } from '@/lib/mail/guest-claim';
import { readUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';
import { claimGuestDonations } from '@/lib/guest-donation-claim';
import { publicUrl } from '@/lib/public-url';

/**
 * A signed-in account with a verified email claims the Guest Donations made
 * under that address by opening a link mailed to it (prd-audit 08; CONTEXT.md,
 * Guest Donor).
 *
 * - **The request is for the signed-in account's own address**, read from its
 *   own row: nothing typed, so it cannot be aimed at another inbox, and the
 *   answer never says whether any Donation matches.
 * - **The token is random, stored as a SHA-256, one-use, 24 hours.** It also
 *   carries the account's email HMAC and key id at issue, and no address.
 * - **The link works only for the account it was issued to.** Opening it
 *   signed in as anyone else is refused and spends nothing.
 * - **Spending and claiming are one transaction.** Any refusal throws and
 *   rolls the whole thing back, so a refused link changes nothing, and of two
 *   concurrent opens exactly one updates the token row.
 * - **Matching is src/lib/guest-donation-claim.ts**: HMAC to HMAC under the
 *   active key id; an already linked, anonymised or older-key-id Donation is
 *   not touched.
 *
 * Rate limiting is the route's job (src/app/api/user/guest-claim/route.ts).
 */

const TOKEN_BYTES = 32;
export const GUEST_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

/** base64url of TOKEN_BYTES random bytes: 43 characters, no padding. */
export const GUEST_CLAIM_TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 4) / 3);
const TOKEN_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${GUEST_CLAIM_TOKEN_LENGTH}}$`);

export type RequestGuestClaimLinkResult =
  | { status: 'sent' }
  | { status: 'unverified' }
  | { status: 'send-failed' }
  | { status: 'not-found' };

class ClaimRefused extends Error {}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function requestGuestClaimLink(
  userId: string,
  now: Date = new Date(),
): Promise<RequestGuestClaimLinkResult> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      emailHmac: true,
      emailHmacKeyId: true,
      emailVerifiedAt: true,
      ...SELECT_USER_EMAIL,
    },
  });
  if (!account) return { status: 'not-found' };
  if (!account.emailVerifiedAt) return { status: 'unverified' };

  const to = readUserEmail(account);
  if (!to) return { status: 'send-failed' };

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const row = await prisma.guestClaimToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      emailHmac: account.emailHmac,
      emailHmacKeyId: account.emailHmacKeyId,
      expiresAt: new Date(now.getTime() + GUEST_CLAIM_TTL_MS),
    },
    select: { id: true },
  });

  const delivered = await sendReportingFailure(
    guestClaimEmail({ to, name: account.name, claimUrl: publicUrl(`/akun/klaim-donasi?token=${token}`) }),
    { mail: 'guest_claim', userId },
  );
  if (!delivered) {
    // A message that never left must not leave a live token nobody holds.
    await prisma.guestClaimToken.delete({ where: { id: row.id } });
    return { status: 'send-failed' };
  }
  return { status: 'sent' };
}

export type ConfirmGuestClaimLinkResult = { ok: true; claimed: number } | { ok: false };

/**
 * Spends a token for `userId` (the signed-in account) and claims. Every
 * refusal is the same `{ ok: false }` -- unknown, spent, expired, another
 * account's, or issued for an address or key id the account no longer has.
 */
export async function confirmGuestClaimLink(
  userId: string,
  token: string,
  now: Date = new Date(),
): Promise<ConfirmGuestClaimLinkResult> {
  if (!TOKEN_PATTERN.test(token)) return { ok: false };

  const row = await prisma.guestClaimToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.userId !== userId || row.usedAt || row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false };
  }

  try {
    const claimed = await prisma.$transaction(async (tx) => {
      const spent = await tx.guestClaimToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (spent.count !== 1) throw new ClaimRefused();

      // The token claims for the address and key id it was issued for. An
      // address changed (which also resets verification, ADR 0020) or re-keyed
      // since issue matches nothing.
      const current = await tx.user.findFirst({
        where: { id: userId, emailHmac: row.emailHmac, emailHmacKeyId: row.emailHmacKeyId, emailVerifiedAt: { not: null } },
        select: { id: true },
      });
      if (!current) throw new ClaimRefused();

      const result = await claimGuestDonations(userId, tx);
      if (!result.verified) throw new ClaimRefused();
      return result.claimed;
    });
    return { ok: true, claimed };
  } catch (error) {
    if (error instanceof ClaimRefused) return { ok: false };
    throw error;
  }
}
