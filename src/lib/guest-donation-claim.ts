import { prisma } from '@/lib/prisma';

/**
 * A Guest Donor who later registers finds their past gifts waiting
 * (prd-compliance 23; CONTEXT.md, Guest Donor). Linking a Donation to an
 * account hands that account the Donation's history and Receipt, so it is
 * guarded three ways:
 *
 * - **Only a verified address claims.** `emailVerifiedAt` is set by opening
 *   the confirmation link sent to the address (src/lib/email-verification.ts),
 *   nothing else. An account registered with someone else's address, however
 *   exactly it matches, sees nothing.
 * - **Matching is HMAC to HMAC (ADR 0012).** The account's stored lookup is
 *   compared with the Donation's stored lookup under the same key id. No
 *   address is decrypted, and no scan runs over decrypted rows.
 * - **An anonymised Donation cannot match.** Anonymising (ticket 36, PR #172)
 *   clears `guestEmailHmac`, and an empty HMAC equals no account's lookup, so
 *   such a row is never found. This file does not name `Donation.anonymisedAt`
 *   (that column is not on `main` until #172 merges). FOLLOW-UP after #172:
 *   add `anonymisedAt: null` to both `where`s below (ticket 23, Comments).
 * - **A rotated key fails safe.** The key id is part of the match. A guest
 *   Donation sealed under an older HMAC key id is not claimed by an account
 *   whose lookup uses a newer one, until the Donation's HMAC is re-keyed
 *   (ADR 0020, key rotation).
 */export async function claimGuestDonations(userId: string): Promise<{ verified: boolean; claimed: number }> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, emailHmac: true, emailHmacKeyId: true, emailVerifiedAt: true },
  });
  if (!account || !account.emailVerifiedAt) return { verified: false, claimed: 0 };
  // An empty lookup would equal a cleared one; it must never match.
  if (!account.emailHmac) return { verified: true, claimed: 0 };

  const candidates = await prisma.donation.findMany({
    where: { donorId: null, guestEmailHmac: account.emailHmac, guestEmailHmacKeyId: account.emailHmacKeyId },
    // Ids only: the read must not pull a guest's name, message or ciphertext
    // into memory for a list the caller is not entitled to see yet.
    select: { id: true },
  });
  if (candidates.length === 0) return { verified: true, claimed: 0 };

  // The write carries the same conditions as the read (donorId, HMAC, key id)
  // rather than trusting it: a Donation linked, anonymised or re-keyed in
  // between no longer matches, and one row is never taken from another account.
  const { count } = await prisma.donation.updateMany({
    where: {
      id: { in: candidates.map((row) => row.id) },
      donorId: null,
      guestEmailHmac: account.emailHmac,
      guestEmailHmacKeyId: account.emailHmacKeyId,
    },
    data: { donorId: account.id },
  });
  return { verified: true, claimed: count };
}
