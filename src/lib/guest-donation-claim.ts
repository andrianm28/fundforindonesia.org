import { prisma } from '@/lib/prisma';

/**
 * A Guest Donor who later registers finds their past gifts waiting
 * (prd-compliance 23; CONTEXT.md, Guest Donor). Linking a Donation to an
 * account hands that account the Donation's history and Receipt, so it is
 * guarded three ways:
 *
 * - **Only a verified address claims.** `emailVerifiedAt` is set by opening
 *   a link mailed to the address: the confirmation link
 *   (src/lib/email-verification.ts) or a password reset link
 *   (src/app/api/auth/password-reset/confirm/route.ts, ADR 0020 amendment),
 *   nothing else. An account registered with someone else's address, however
 *   exactly it matches, sees nothing.
 * - **Matching is HMAC to HMAC (ADR 0012).** The account's stored lookup is
 *   compared with the Donation's stored lookup under the same key id. No
 *   address is decrypted, and no scan runs over decrypted rows.
 * - **An anonymised Donation cannot match.** Anonymising (ticket 36, PR #172)
 *   clears `guestEmailHmac` and sets `anonymisedAt`. Both `where`s below
 *   require `anonymisedAt: null`, so such a row is excluded even if an HMAC
 *   were ever left on it; an empty HMAC equals no account's lookup either.
 * - **A rotated key fails safe.** The key id is part of the match. A guest
 *   Donation sealed under an older HMAC key id is not claimed by an account
 *   whose lookup uses a newer one, until the Donation's HMAC is re-keyed
 *   (ADR 0020, key rotation).
 */
export async function claimGuestDonations(userId: string): Promise<{ verified: boolean; claimed: number }> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, emailHmac: true, emailHmacKeyId: true, emailVerifiedAt: true },
  });
  if (!account || !account.emailVerifiedAt) return { verified: false, claimed: 0 };
  // An empty lookup would equal a cleared one; it must never match.
  if (!account.emailHmac) return { verified: true, claimed: 0 };

  const candidates = await prisma.donation.findMany({
    where: {
      donorId: null,
      anonymisedAt: null,
      guestEmailHmac: account.emailHmac,
      guestEmailHmacKeyId: account.emailHmacKeyId,
    },
    // Ids only: the read must not pull a guest's name, message or ciphertext
    // into memory for a list the caller is not entitled to see yet.
    select: { id: true },
  });
  if (candidates.length === 0) return { verified: true, claimed: 0 };

  // The write carries the same conditions as the read (donorId, anonymisedAt, HMAC, key id)
  // rather than trusting it: a Donation linked, anonymised or re-keyed in
  // between no longer matches, and one row is never taken from another account.
  const { count } = await prisma.donation.updateMany({
    where: {
      id: { in: candidates.map((row) => row.id) },
      donorId: null,
      anonymisedAt: null,
      guestEmailHmac: account.emailHmac,
      guestEmailHmacKeyId: account.emailHmacKeyId,
    },
    data: { donorId: account.id },
  });
  return { verified: true, claimed: count };
}
