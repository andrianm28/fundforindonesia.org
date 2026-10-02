import { Prisma, RefundStatus, type PrismaClient } from '@/generated/prisma/client';
import { CLEAR_DONATION_GUEST_CONTACT } from '@/lib/contact-fields';
import { AnonymisationBlockedByOpenRefundError } from '@/lib/money/errors';

/**
 * Donor anonymisation (PRD FFI-16; ADR 0012, Consequences; ticket 36): a
 * Donor's identity is removed from their Donations and the money stays.
 *
 * WHAT IS REMOVED, per Donation: the plaintext name, the email HMAC and
 * ciphertext, the phone ciphertext (with their key ids) -- see
 * CLEAR_DONATION_GUEST_CONTACT -- and the `donorId` link to a registered
 * account. `isAnonymous` becomes true, so every public and Fundraiser view
 * that already hides an anonymous Donor hides this one with no further code,
 * and `anonymisedAt` is stamped so a Refund can be refused (createRefund) and
 * a late Receipt email skipped. The Prayer a registered Donor wrote loses its
 * `userId`; its text stays, because it is already shown as the Donation's.
 *
 * WHY THE HMAC GOES TOO: the HMAC is deterministic, so a row that keeps it is
 * linkable to every other row, and to an account, that carries the same
 * address -- keeping it would keep the person, only harder to read.
 *
 * WHAT IS KEPT, and why: the Donation row (amount, status, Campaign, date,
 * traffic source, ikrar flag), its Payments, its Receipt (the print page shows
 * "Donor anonim"), and every ledger entry. They are financial records the PRD
 * keeps ten years (FFI-16: "nominal dan jurnal tetap; data keuangan disimpan
 * sepuluh tahun"), and nothing here reads or writes the ledger. A finished
 * Refund keeps its recorded destination (bank, account name, sealed number)
 * for the same reason: it is the proof of where returned money went. Whether
 * that should also be erased is not decided in writing and is left to the
 * owner. The registered account itself
 * (User row) is untouched: it is the Donor's own, removing it is a different
 * request.
 *
 * WHO MAY ASK: a Guest Donor, by holding the Receipt link, for Donations that
 * belong to no account; a registered Donor, by their session, for their own.
 * The route layer decides who; this module takes the subject as given.
 *
 * IDEMPOTENT and not undoable: only rows with `anonymisedAt` null are changed,
 * and nothing ever clears it, because the original values are gone.
 *
 * REFUND INTERLOCK: while a Refund on any of these Donations is not finished
 * (anything but COMPLETED, REJECTED, FAILED) the request is refused, because
 * that Refund's destination was approved against the Donor's name and removing
 * it would strand money already frozen for return. The refusal and createRefund's
 * own check both run under the Payment row lock, so a Refund and an
 * anonymisation racing on one Donation cannot both succeed.
 */

const FINISHED_REFUND_STATUSES: RefundStatus[] = [RefundStatus.COMPLETED, RefundStatus.REJECTED, RefundStatus.FAILED];

export type AnonymisationResult = {
  status: 'anonymised' | 'already-anonymised';
  /** Donations changed by this call: 0 when it was a repeat. */
  anonymisedCount: number;
};

export type GuestAnonymisationResult = AnonymisationResult | { status: 'not-found' } | { status: 'account-owned' };

async function anonymiseDonations(
  client: PrismaClient,
  select: (tx: Prisma.TransactionClient) => Promise<string[]>,
  now: Date,
): Promise<AnonymisationResult> {
  return client.$transaction(async (tx) => {
    const donationIds = await select(tx);
    if (donationIds.length === 0) return { status: 'already-anonymised', anonymisedCount: 0 };

    // The lock createRefund takes before it reads the Donation, in id order so
    // two anonymisations cannot deadlock each other.
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE "donationId" IN (${Prisma.join(donationIds)}) ORDER BY id FOR UPDATE`;

    const open = await tx.refund.findFirst({
      where: { payment: { donationId: { in: donationIds } }, status: { notIn: FINISHED_REFUND_STATUSES } },
      select: { id: true },
    });
    if (open) throw new AnonymisationBlockedByOpenRefundError();

    const changed = await tx.donation.updateMany({
      where: { id: { in: donationIds }, anonymisedAt: null },
      data: { ...CLEAR_DONATION_GUEST_CONTACT, donorId: null, isAnonymous: true, anonymisedAt: now },
    });
    await tx.prayer.updateMany({
      where: { donationId: { in: donationIds }, userId: { not: null } },
      data: { userId: null },
    });
    return {
      status: changed.count > 0 ? 'anonymised' : 'already-anonymised',
      anonymisedCount: changed.count,
    };
  });
}

/**
 * A Guest Donor asks from the link in their Receipt. Removes the identity from
 * every Guest Donation carrying the same email HMAC as the Receipt's Donation,
 * because leaving the others would leave the person findable by that HMAC.
 *
 * A Donation that belongs to an account is refused (`account-owned`): the
 * token is only an inbox's proof, and the account's own session is the right
 * proof for that Donor.
 */
export async function anonymiseGuestDonor(
  client: PrismaClient,
  params: { token: string; now?: Date },
): Promise<GuestAnonymisationResult> {
  const now = params.now ?? new Date();
  const receipt = await client.receipt.findUnique({
    where: { token: params.token },
    select: { donation: { select: { id: true, donorId: true, anonymisedAt: true, guestEmailHmac: true } } },
  });
  if (!receipt) return { status: 'not-found' };

  const { donation } = receipt;
  if (donation.anonymisedAt) return { status: 'already-anonymised', anonymisedCount: 0 };
  if (donation.donorId) return { status: 'account-owned' };

  return anonymiseDonations(
    client,
    async (tx) => {
      const rows = await tx.donation.findMany({
        where: {
          anonymisedAt: null,
          donorId: null,
          OR: [{ id: donation.id }, ...(donation.guestEmailHmac ? [{ guestEmailHmac: donation.guestEmailHmac }] : [])],
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      return rows.map((r) => r.id);
    },
    now,
  );
}

/** A registered Donor asks from account settings, for the Donations linked to their account. */
export async function anonymiseRegisteredDonor(
  client: PrismaClient,
  params: { userId: string; now?: Date },
): Promise<AnonymisationResult> {
  const now = params.now ?? new Date();
  return anonymiseDonations(
    client,
    async (tx) => {
      const rows = await tx.donation.findMany({
        where: { donorId: params.userId, anonymisedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      return rows.map((r) => r.id);
    },
    now,
  );
}
