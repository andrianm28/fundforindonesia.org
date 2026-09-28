import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Matches src/lib/money/impact.test.ts's own mock shape: a fake tx object
// handed to the callback passed to $transaction, so the function under test
// is exercised through its real Prisma call shape rather than a stub that
// merely returns canned totals.
const tx = {
  campaign: { findMany: vi.fn() },
  campaignStatusChange: { findMany: vi.fn() },
  ledgerEntry: { groupBy: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { dormantBalanceReport } from './dormant-balances';

const mockTransaction = prisma.$transaction as unknown as Mock;

const NOW = new Date('2026-09-28T00:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * MS_PER_DAY);

function balanceRows(campaignId: string, netCredit: number) {
  return [
    { campaignId, direction: 'CREDIT', _sum: { amount: netCredit } },
    { campaignId, direction: 'DEBIT', _sum: { amount: 0 } },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
  tx.campaignStatusChange.findMany.mockResolvedValue([]);
  tx.ledgerEntry.groupBy.mockResolvedValue([]);
});

describe('dormantBalanceReport', () => {
  it('lists an Expired Campaign whose deadline passed 61 days ago and still holds a balance, using its deadline as the since-date', async () => {
    tx.campaign.findMany.mockResolvedValue([
      {
        id: 'campaign-1',
        slug: 'sumur-desa',
        title: 'Sumur untuk Desa',
        lifecycleStatus: 'EXPIRED',
        deadline: daysAgo(61),
      },
    ]);
    tx.ledgerEntry.groupBy.mockResolvedValue(balanceRows('campaign-1', 2_000_000));

    const rows = await dormantBalanceReport(prisma as never, NOW);

    expect(rows).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        slug: 'sumur-desa',
        title: 'Sumur untuk Desa',
        status: 'EXPIRED',
        since: daysAgo(61),
        daysSince: 61,
        balance: 2_000_000,
      }),
    ]);
  });

  it('excludes a Campaign whose Expired/Completed since-date is under the 60-day threshold', async () => {
    tx.campaign.findMany.mockResolvedValue([
      {
        id: 'campaign-2',
        slug: 'baru-selesai',
        title: 'Baru Selesai',
        lifecycleStatus: 'EXPIRED',
        deadline: daysAgo(10),
      },
    ]);
    tx.ledgerEntry.groupBy.mockResolvedValue(balanceRows('campaign-2', 1_000_000));

    const rows = await dormantBalanceReport(prisma as never, NOW);

    expect(rows).toEqual([]);
  });

  it('excludes a Campaign whose Campaign Balance has already been paid out to zero', async () => {
    tx.campaign.findMany.mockResolvedValue([
      {
        id: 'campaign-3',
        slug: 'sudah-cair',
        title: 'Sudah Cair',
        lifecycleStatus: 'EXPIRED',
        deadline: daysAgo(90),
      },
    ]);
    tx.ledgerEntry.groupBy.mockResolvedValue([
      { campaignId: 'campaign-3', direction: 'CREDIT', _sum: { amount: 2_000_000 } },
      { campaignId: 'campaign-3', direction: 'DEBIT', _sum: { amount: 2_000_000 } },
    ]);

    const rows = await dormantBalanceReport(prisma as never, NOW);

    expect(rows).toEqual([]);
  });

  it('excludes an Active Campaign whose deadline has not passed', async () => {
    tx.campaign.findMany.mockResolvedValue([
      {
        id: 'campaign-4',
        slug: 'masih-jalan',
        title: 'Masih Jalan',
        lifecycleStatus: 'ACTIVE',
        deadline: new Date(NOW.getTime() + MS_PER_DAY),
      },
    ]);
    tx.ledgerEntry.groupBy.mockResolvedValue(balanceRows('campaign-4', 1_000_000));

    const rows = await dormantBalanceReport(prisma as never, NOW);

    expect(rows).toEqual([]);
  });

  it('lists a Completed Campaign using its recorded COMPLETED transition as the since-date, not its deadline', async () => {
    tx.campaign.findMany.mockResolvedValue([
      {
        id: 'campaign-5',
        slug: 'program-wakaf',
        title: 'Program Wakaf',
        lifecycleStatus: 'COMPLETED',
        deadline: null,
      },
    ]);
    tx.campaignStatusChange.findMany.mockResolvedValue([
      { campaignId: 'campaign-5', toStatus: 'COMPLETED', createdAt: daysAgo(75) },
    ]);
    tx.ledgerEntry.groupBy.mockResolvedValue(balanceRows('campaign-5', 5_000_000));

    const rows = await dormantBalanceReport(prisma as never, NOW);

    expect(rows).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-5',
        status: 'COMPLETED',
        since: daysAgo(75),
        daysSince: 75,
        balance: 5_000_000,
      }),
    ]);
  });

  it('never considers a Demo Campaign, even with a stale balance', async () => {
    tx.campaign.findMany.mockResolvedValue([]);

    const rows = await dormantBalanceReport(prisma as never, NOW);

    expect(tx.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isDemo: false }) }),
    );
    expect(rows).toEqual([]);
  });

  it('sorts rows by longest-dormant first', async () => {
    tx.campaign.findMany.mockResolvedValue([
      { id: 'campaign-6', slug: 'a', title: 'A', lifecycleStatus: 'EXPIRED', deadline: daysAgo(61) },
      { id: 'campaign-7', slug: 'b', title: 'B', lifecycleStatus: 'EXPIRED', deadline: daysAgo(120) },
    ]);
    tx.ledgerEntry.groupBy.mockResolvedValue([
      ...balanceRows('campaign-6', 1_000_000),
      ...balanceRows('campaign-7', 1_000_000),
    ]);

    const rows = await dormantBalanceReport(prisma as never, NOW);

    expect(rows.map((r) => r.campaignId)).toEqual(['campaign-7', 'campaign-6']);
  });
});
