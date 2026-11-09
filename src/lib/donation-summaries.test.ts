import { describe, it, expect, vi } from 'vitest';
import { supportedCampaignsForDonor, incomeSummaryForFundraiser } from './donation-summaries';

/**
 * PKS 3.8-3.9. Only settled ("confirmed", the PAID of CONTEXT.md) Donations
 * count: the pending and failed ones must never reach a total. The fake
 * `groupBy` applies the `where` it is given to real rows, so a missing filter
 * shows up as a wrong number rather than a missing assertion.
 */

type Row = { campaignId: string; donorId: string; paymentStatus: string; amount: number; sandboxOnly?: boolean };

function fakeDb(rows: Row[], campaigns: Array<{ id: string; slug: string; title: string; coverImage: string; creatorId: string }>) {
  const groupBy = vi.fn(async (args: { where: Record<string, unknown> }) => {
    const w = args.where as {
      donorId?: string;
      paymentStatus?: string;
      campaignId?: { in: string[] };
      payments?: { some: { sandbox: boolean } };
    };
    const matched = rows.filter(
      (r) =>
        (w.donorId === undefined || r.donorId === w.donorId) &&
        (w.paymentStatus === undefined || r.paymentStatus === w.paymentStatus) &&
        (w.campaignId === undefined || w.campaignId.in.includes(r.campaignId)) &&
        (w.payments === undefined || !!r.sandboxOnly === w.payments.some.sandbox),
    );
    const byCampaign = new Map<string, { sum: number; count: number }>();
    for (const r of matched) {
      const cur = byCampaign.get(r.campaignId) ?? { sum: 0, count: 0 };
      byCampaign.set(r.campaignId, { sum: cur.sum + r.amount, count: cur.count + 1 });
    }
    return [...byCampaign].map(([campaignId, v]) => ({ campaignId, _sum: { amount: v.sum }, _count: { _all: v.count } }));
  });
  const findMany = vi.fn(async (args: { where: { id?: { in: string[] }; creatorId?: string } }) =>
    campaigns.filter(
      (c) => (args.where.id === undefined || args.where.id.in.includes(c.id)) && (args.where.creatorId === undefined || c.creatorId === args.where.creatorId),
    ),
  );
  return { donation: { groupBy }, campaign: { findMany } } as never;
}

const campaigns = [
  { id: 'c1', slug: 'sekolah', title: 'Sekolah', coverImage: '', creatorId: 'f1' },
  { id: 'c2', slug: 'sumur', title: 'Sumur', coverImage: '', creatorId: 'f1' },
  { id: 'c3', slug: 'lain', title: 'Lain', coverImage: '', creatorId: 'f2' },
];

describe('supportedCampaignsForDonor', () => {
  it('lists each Campaign once with the total of settled Donations only', async () => {
    const db = fakeDb(
      [
        { campaignId: 'c1', donorId: 'd1', paymentStatus: 'confirmed', amount: 100_000 },
        { campaignId: 'c1', donorId: 'd1', paymentStatus: 'confirmed', amount: 50_000 },
        { campaignId: 'c1', donorId: 'd1', paymentStatus: 'pending', amount: 900_000 },
        { campaignId: 'c2', donorId: 'd1', paymentStatus: 'failed', amount: 700_000 },
        { campaignId: 'c3', donorId: 'd1', paymentStatus: 'confirmed', amount: 25_000 },
        { campaignId: 'c3', donorId: 'other', paymentStatus: 'confirmed', amount: 999_000 },
      ],
      campaigns,
    );

    const result = await supportedCampaignsForDonor(db, 'd1');

    expect(result).toEqual([
      { slug: 'sekolah', title: 'Sekolah', coverImage: '', totalAmount: 150_000, donationCount: 2 },
      { slug: 'lain', title: 'Lain', coverImage: '', totalAmount: 25_000, donationCount: 1 },
    ]);
  });

  it('leaves out a Donation whose Payment is sandbox, like the Fundraiser view', async () => {
    const db = fakeDb(
      [
        { campaignId: 'c1', donorId: 'd1', paymentStatus: 'confirmed', amount: 100_000 },
        { campaignId: 'c1', donorId: 'd1', paymentStatus: 'confirmed', amount: 3_000_000, sandboxOnly: true },
        { campaignId: 'c2', donorId: 'd1', paymentStatus: 'confirmed', amount: 9_000_000, sandboxOnly: true },
      ],
      campaigns,
    );
    expect(await supportedCampaignsForDonor(db, 'd1')).toEqual([
      { slug: 'sekolah', title: 'Sekolah', coverImage: '', totalAmount: 100_000, donationCount: 1 },
    ]);
  });

  it('is empty when the Donor has no settled Donation', async () => {
    const db = fakeDb([{ campaignId: 'c1', donorId: 'd1', paymentStatus: 'pending', amount: 1 }], campaigns);
    expect(await supportedCampaignsForDonor(db, 'd1')).toEqual([]);
  });
});

describe('incomeSummaryForFundraiser', () => {
  it('totals settled Donations per Campaign and overall, for the Fundraiser own Campaigns only', async () => {
    const db = fakeDb(
      [
        { campaignId: 'c1', donorId: 'a', paymentStatus: 'confirmed', amount: 100_000 },
        { campaignId: 'c1', donorId: 'b', paymentStatus: 'confirmed', amount: 40_000 },
        { campaignId: 'c1', donorId: 'c', paymentStatus: 'pending', amount: 5_000_000 },
        { campaignId: 'c2', donorId: 'a', paymentStatus: 'failed', amount: 5_000_000 },
        { campaignId: 'c3', donorId: 'a', paymentStatus: 'confirmed', amount: 7_000_000 },
        { campaignId: 'c1', donorId: 'd', paymentStatus: 'confirmed', amount: 3_000_000, sandboxOnly: true },
      ],
      campaigns,
    );

    const result = await incomeSummaryForFundraiser(db, 'f1');

    expect(result.total).toBe(140_000);
    expect(result.perCampaign).toEqual([
      { campaignId: 'c1', slug: 'sekolah', title: 'Sekolah', totalAmount: 140_000, donationCount: 2 },
      { campaignId: 'c2', slug: 'sumur', title: 'Sumur', totalAmount: 0, donationCount: 0 },
    ]);
  });

  it('is zero for a Fundraiser with no Campaign', async () => {
    expect(await incomeSummaryForFundraiser(fakeDb([], campaigns), 'nobody')).toEqual({ total: 0, perCampaign: [] });
  });
});
