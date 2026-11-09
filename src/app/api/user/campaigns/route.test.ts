import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { campaignRow, makeCampaignDb, verificationRequestRow } from '../../../../../tests/support/in-memory-campaign-db';

/**
 * GET /api/user/campaigns feeds "Kampanye Saya". It sends one status field,
 * the effective `lifecycleStatus`, so the Fundraiser's list matches the
 * public page. Run against the in-memory Campaign db.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../../tests/support/in-memory-campaign-db').makeCampaignDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

// PKS 3.9: the aggregation has its own tests in src/lib/donation-summaries.test.ts.
vi.mock('@/lib/donation-summaries', () => ({
  incomeSummaryForFundraiser: vi.fn().mockResolvedValue({ total: 0, perCampaign: [] }),
}));

import { getServerSession } from '@/lib/auth';
import { incomeSummaryForFundraiser } from '@/lib/donation-summaries';
import { GET } from './route';

const NOW = new Date('2026-09-25T12:00:00Z');

async function fetchMine() {
  const response = await GET(new NextRequest('http://localhost:3000/api/user/campaigns'));
  expect(response.status).toBe(200);
  return (await response.json()).campaigns as Record<string, unknown>[];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'creator-1' } } as never);
  holder.db = makeCampaignDb({
    campaigns: [
      campaignRow({ id: 'running', slug: 'running', lifecycleStatus: 'ACTIVE', deadline: new Date('2026-09-26T12:00:00Z') }),
      campaignRow({ id: 'lapsed', slug: 'lapsed', lifecycleStatus: 'ACTIVE', deadline: new Date('2026-09-24T12:00:00Z') }),
      campaignRow({ id: 'waiting', slug: 'waiting', lifecycleStatus: 'SUBMITTED' }),
      campaignRow({ id: 'someone-elses', slug: 'someone-elses', creatorId: 'creator-2' }),
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/user/campaigns', () => {
  it("sends each of the Fundraiser's Campaigns with its effective lifecycleStatus", async () => {
    const statuses = Object.fromEntries((await fetchMine()).map((c) => [c.slug, c.lifecycleStatus]));

    expect(statuses).toEqual({ running: 'ACTIVE', lapsed: 'EXPIRED', waiting: 'SUBMITTED' });
  });

  it('sends the id of the PENDING Verification Request a Submitted Campaign waits on, and null otherwise', async () => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaignRow({ id: 'waiting', slug: 'waiting', lifecycleStatus: 'SUBMITTED' }),
        campaignRow({ id: 'refused', slug: 'refused', lifecycleStatus: 'REJECTED' }),
      ],
      verificationRequests: [
        verificationRequestRow({ id: 'old-refusal', campaignId: 'waiting', outcome: 'REJECTED' }),
        verificationRequestRow({ id: 'open', campaignId: 'waiting', outcome: 'PENDING', isFirst: false }),
        verificationRequestRow({ id: 'refusal', campaignId: 'refused', outcome: 'REJECTED' }),
      ],
    });

    const pending = Object.fromEntries((await fetchMine()).map((c) => [c.slug, c.pendingVerificationRequestId]));

    expect(pending).toEqual({ waiting: 'open', refused: null });
  });

  it('sends whether a Rejected Campaign was closed for good, so the list can read Ditolak and stop offering a resubmission (PKS pasal 3.4)', async () => {
    holder.db = makeCampaignDb({
      campaigns: [
        campaignRow({ id: 'revisi', slug: 'revisi', lifecycleStatus: 'REJECTED', rejectionFinal: false }),
        campaignRow({ id: 'final', slug: 'final', lifecycleStatus: 'REJECTED', rejectionFinal: true }),
      ],
    });

    const closed = Object.fromEntries((await fetchMine()).map((c) => [c.slug, c.rejectionFinal]));

    expect(closed).toEqual({ revisi: false, final: true });
  });

  it("sends the Fundraiser's income summary, asked for this Fundraiser only (PKS 3.9)", async () => {
    const income = { total: 9, perCampaign: [{ campaignId: 'running', slug: 'running', title: 'R', totalAmount: 9, donationCount: 1 }] };
    vi.mocked(incomeSummaryForFundraiser).mockResolvedValueOnce(income);

    const response = await GET(new NextRequest('http://localhost:3000/api/user/campaigns'));

    expect((await response.json()).income).toEqual(income);
    expect(vi.mocked(incomeSummaryForFundraiser).mock.calls.at(-1)?.[1]).toBe('creator-1');
  });

  it('sends no legacy status field', async () => {
    for (const campaign of await fetchMine()) {
      expect(campaign).not.toHaveProperty('status');
    }
  });
});
