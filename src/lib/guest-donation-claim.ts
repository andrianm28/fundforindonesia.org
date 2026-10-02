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
 * - **An anonymised Donation is never claimed** (ticket 36, PR #172, which adds
 *   `Donation.anonymisedAt`). That change also clears the HMAC, so the match
 *   above already cannot find such a row; the field is checked as well, and
 *   read defensively off the row rather than named in a `select` or `where`, so
 *   this file compiles and behaves the same before and after #172 merges.
 *   After it merges, `anonymisedAt: null` can join the `where` below.
 */
export async function claimGuestDonations(userId: string): Promise<{ verified: boolean; claimed: number }> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, emailHmac: true, emailHmacKeyId: true, emailVerifiedAt: true },
  });
  if (!account || !account.emailVerifiedAt) return { verified: false, claimed: 0 };

  const candidates = await prisma.donation.findMany({
    where: { donorId: null, guestEmailHmac: account.emailHmac, guestEmailHmacKeyId: account.emailHmacKeyId },
  });
  const claimable = candidates.filter((row) => !isAnonymised(row));
  if (claimable.length === 0) return { verified: true, claimed: 0 };

  // The where repeats the guard rather than trusting the read above: a Donation
  // linked or anonymised in between no longer matches, and one row is never
  // taken from another account.
  const { count } = await prisma.donation.updateMany({
    where: { id: { in: claimable.map((row) => row.id) }, donorId: null, guestEmailHmac: account.emailHmac },
    data: { donorId: account.id },
  });
  return { verified: true, claimed: count };
}

/** True when the row carries an `anonymisedAt` that is set. Absent (pre-#172 schema) reads as not anonymised. */
function isAnonymised(row: object): boolean {
  return 'anonymisedAt' in row && row.anonymisedAt != null;
}
