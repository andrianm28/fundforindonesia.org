import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Totals shown to the people who gave and to the people who raise (PKS 3.8
 * and 3.9). Only settled Donations count: `paymentStatus` "confirmed", the
 * PAID of CONTEXT.md. Pending and failed ones never reach a number here.
 */

type Db = Pick<PrismaClient, 'donation' | 'campaign'>;

const SETTLED = 'confirmed';

export type SupportedCampaign = {
  slug: string;
  title: string;
  coverImage: string;
  totalAmount: number;
  donationCount: number;
};

/**
 * "Kampanye yang Anda dukung": one row per Campaign the Donor has a settled
 * Donation on, biggest total first. This is the Donor's own view of their own
 * giving, so anonymity (which only hides them from others) does not apply.
 */
export async function supportedCampaignsForDonor(db: Db, donorId: string): Promise<SupportedCampaign[]> {
  const groups = await db.donation.groupBy({
    by: ['campaignId'],
    where: { donorId, paymentStatus: SETTLED },
    _sum: { amount: true },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];

  const campaigns = await db.campaign.findMany({
    where: { id: { in: groups.map((g) => g.campaignId) } },
    select: { id: true, slug: true, title: true, coverImage: true },
  });
  const byId = new Map(campaigns.map((c) => [c.id, c]));

  return groups
    .flatMap((g) => {
      const campaign = byId.get(g.campaignId);
      if (!campaign) return [];
      return [
        {
          slug: campaign.slug,
          title: campaign.title,
          coverImage: campaign.coverImage,
          totalAmount: g._sum.amount ?? 0,
          donationCount: g._count._all,
        },
      ];
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

export type FundraiserIncome = {
  total: number;
  perCampaign: Array<{ campaignId: string; slug: string; title: string; totalAmount: number; donationCount: number }>;
};

/**
 * The Fundraiser's incoming money: settled Donations per own Campaign and in
 * all. A Donation whose Payment was stamped sandbox is test money and is left
 * out, as everywhere else real figures are published (counted-payment.ts).
 */
export async function incomeSummaryForFundraiser(db: Db, creatorId: string): Promise<FundraiserIncome> {
  const campaigns = await db.campaign.findMany({
    where: { creatorId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, slug: true, title: true },
  });
  if (campaigns.length === 0) return { total: 0, perCampaign: [] };

  const groups = await db.donation.groupBy({
    by: ['campaignId'],
    where: {
      campaignId: { in: campaigns.map((c) => c.id) },
      paymentStatus: SETTLED,
      NOT: { payments: { some: { sandbox: true } } },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const byCampaign = new Map(groups.map((g) => [g.campaignId, g]));

  const perCampaign = campaigns.map((c) => ({
    campaignId: c.id,
    slug: c.slug,
    title: c.title,
    totalAmount: byCampaign.get(c.id)?._sum.amount ?? 0,
    donationCount: byCampaign.get(c.id)?._count._all ?? 0,
  }));
  return { total: perCampaign.reduce((sum, c) => sum + c.totalAmount, 0), perCampaign };
}
