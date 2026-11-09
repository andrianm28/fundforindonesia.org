import type { Prisma } from '@/generated/prisma/client';
import { countedPaymentWhere } from '@/lib/money/counted-payment';

/**
 * "Donatur teratas" on the Campaign page (PKS Pasal 3.7b): the largest
 * Donations of one Campaign.
 *
 * Only a Donation that was actually paid counts: confirmed, with a PAID
 * Payment that counts (counted-payment.ts; a beta/sandbox Payment never does,
 * and a REFUNDED one is no longer PAID).
 *
 * Donor anonymity (ADR 0023, and the Donation list beside it): an anonymous
 * Donation, including one a Donor had anonymised later, shows as "Anonim", the
 * same word the Donation list uses, and the entry carries ONLY rank, name and
 * amount. No Donation id, date, message, avatar or contact detail leaves this
 * function, so an anonymous entry cannot be tied to a person or to a Receipt;
 * the query does not even select them.
 */
export const TOP_DONORS_LIMIT = 10;

export interface TopDonor {
  rank: number;
  donorName: string;
  amount: number;
}

export async function topDonorsForCampaign(
  db: Pick<Prisma.TransactionClient, 'donation'>,
  campaignId: string,
  limit: number = TOP_DONORS_LIMIT,
): Promise<TopDonor[]> {
  const rows = await db.donation.findMany({
    where: {
      campaignId,
      paymentStatus: 'confirmed',
      payments: { some: { status: 'PAID', ...countedPaymentWhere() } },
    },
    select: {
      amount: true,
      isAnonymous: true,
      guestName: true,
      donor: { select: { name: true } },
    },
    // The earlier Donation wins a tie, so the list does not reshuffle.
    orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
    take: limit,
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    donorName: row.isAnonymous ? 'Anonim' : row.donor?.name || row.guestName || 'Anonim',
    amount: row.amount,
  }));
}
