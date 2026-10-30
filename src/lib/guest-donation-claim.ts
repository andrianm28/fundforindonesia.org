import { prisma } from '@/lib/prisma';
import { lookupDonationGuestEmail, readUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';

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
 * - **Matching is by HMAC (ADR 0012).** The account's address is read once
 *   (it is already verified) and looked up under every configured HMAC key,
 *   each pair of hash and key id kept together; the Donation's stored lookup
 *   must equal one pair. No Donation is decrypted, and no scan runs over
 *   decrypted rows.
 * - **An anonymised Donation cannot match.** Anonymising (ticket 36, PR #172)
 *   clears `guestEmailHmac` and sets `anonymisedAt`. Both `where`s below
 *   require `anonymisedAt: null`, so such a row is excluded even if an HMAC
 *   were ever left on it; an empty HMAC equals no account's lookup either.
 * - **A rotated key still matches.** Because the lookup covers current and
 *   retired HMAC keys, an account hashed under an old key claims a Donation
 *   hashed under the new one, and the reverse, with no re-hash needed.
 */
export async function claimGuestDonations(userId: string): Promise<{ verified: boolean; claimed: number }> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, emailVerifiedAt: true, ...SELECT_USER_EMAIL },
  });
  if (!account || !account.emailVerifiedAt) return { verified: false, claimed: 0 };
  // No readable address means nothing to look up; never fall back to a match on a cleared HMAC.
  const email = readUserEmail(account);
  if (!email) return { verified: true, claimed: 0 };
  const lookup = lookupDonationGuestEmail(email);

  const candidates = await prisma.donation.findMany({
    where: {
      donorId: null,
      anonymisedAt: null,
      ...lookup,
    },
    // Ids only: the read must not pull a guest's name, message or ciphertext
    // into memory for a list the caller is not entitled to see yet.
    select: { id: true },
  });
  if (candidates.length === 0) return { verified: true, claimed: 0 };

  // The write carries the same conditions as the read (donorId, anonymisedAt, the HMAC / key id pairs)
  // rather than trusting it: a Donation linked, anonymised or re-keyed in
  // between no longer matches, and one row is never taken from another account.
  const { count } = await prisma.donation.updateMany({
    where: {
      id: { in: candidates.map((row) => row.id) },
      donorId: null,
      anonymisedAt: null,
      ...lookup,
    },
    data: { donorId: account.id },
  });
  return { verified: true, claimed: count };
}
