import { describe, it, expect } from 'vitest';
import {
  ABUSE_THRESHOLD_DEFAULTS,
  activeCampaignCountsByFundraiser,
  InvalidAbuseThresholdError,
  resolveAbuseThresholds,
  setAbuseThreshold,
} from './abuse-thresholds';

/**
 * The abuse thresholds an Admin sets (prd-compliance 38, PRD
 * §"Anti penyalahgunaan"). The four numbers the PRD states live in one
 * place, here, and a settled Donation, a Campaign's audit marker and a
 * Fundraiser's fourth Active Campaign all read them from here -- so nobody
 * can end up with two answers to "what is the limit".
 */

type ThresholdRow = { kind: string; value: number; setAt: string };

function makeDb(seed: { rows?: ThresholdRow[] } = {}) {
  const created: Record<string, unknown>[] = [];
  const db = {
    abuseThreshold: {
      // The stand-in answers the query it is given, including its order: rows
      // come back newest first, which is what makes "the latest row wins"
      // true for a table that only ever grows.
      findMany: async ({ orderBy }: { orderBy?: { setAt: string } } = {}) => {
        const rows = [...(seed.rows ?? [])];
        if (orderBy?.setAt === "desc") rows.sort((a, b) => b.setAt.localeCompare(a.setAt));
        return rows;
      },
      create: async ({ data }: { data: { kind: string; value: number; setById: string; setAt: Date } }) => {
        const row: Record<string, unknown> = { id: `threshold-${created.length + 1}`, ...data };
        created.push(row);
        return row;
      },
    },
  };
  return { db, created };
}

describe('resolveAbuseThresholds', () => {
  it('answers the PRD numbers until an Admin has set any of them', async () => {
    const { db } = makeDb();

    expect(await resolveAbuseThresholds(db as never)).toEqual({
      campaignReviewGross: 100_000_000,
      campaignAuditGross: 500_000_000,
      donationReviewAmount: 50_000_000,
      activeCampaignsPerFundraiser: 3,
    });
    expect(ABUSE_THRESHOLD_DEFAULTS.campaignReviewGross).toBe(100_000_000);
  });

  it("takes each Admin's latest row, and leaves the rest of the numbers alone", async () => {
    const { db } = makeDb({
      rows: [
        { kind: 'CAMPAIGN_REVIEW_GROSS', value: 60_000_000, setAt: '2026-09-01T00:00:00Z' },
        { kind: 'CAMPAIGN_REVIEW_GROSS', value: 250_000_000, setAt: '2026-09-20T00:00:00Z' },
        { kind: 'DONATION_REVIEW_AMOUNT', value: 75_000_000, setAt: '2026-09-10T00:00:00Z' },
      ],
    });

    const thresholds = await resolveAbuseThresholds(db as never);

    expect(thresholds.campaignReviewGross).toBe(250_000_000);
    expect(thresholds.donationReviewAmount).toBe(75_000_000);
    // Untouched kinds keep the PRD's number rather than dropping to zero.
    expect(thresholds.campaignAuditGross).toBe(500_000_000);
    expect(thresholds.activeCampaignsPerFundraiser).toBe(3);
  });
});

describe('setAbuseThreshold', () => {
  it('records the Admin and the time by inserting a row, never by editing one', async () => {
    const { db, created } = makeDb();
    const now = new Date('2026-09-28T02:00:00Z');

    const row = await setAbuseThreshold(db as never, {
      kind: 'CAMPAIGN_AUDIT_GROSS',
      value: 750_000_000,
      actorId: 'admin-1',
      now,
    });

    expect(row).toMatchObject({ kind: 'CAMPAIGN_AUDIT_GROSS', value: 750_000_000, setById: 'admin-1', setAt: now });
    expect(created).toHaveLength(1);
  });

  it('refuses a number that is not a whole rupiah amount above zero, and writes nothing', async () => {
    const { db, created } = makeDb();

    for (const value of [0, -1, 1.5, Number.NaN, '100000000']) {
      await expect(
        setAbuseThreshold(db as never, {
          kind: 'DONATION_REVIEW_AMOUNT',
          value: value as number,
          actorId: 'admin-1',
        })
      ).rejects.toBeInstanceOf(InvalidAbuseThresholdError);
    }
    expect(created).toEqual([]);
  });
});

describe('activeCampaignCountsByFundraiser', () => {
  const NOW = new Date('2026-09-28T07:00:00Z');
  const FUTURE = new Date('2026-12-31T00:00:00Z');
  const PAST = new Date('2026-09-01T00:00:00Z');

  function dbWith(campaigns: { id: string; creatorId: string; lifecycleStatus: string; deadline: Date | null; isDemo: boolean }[]) {
    return {
      campaign: {
        // Answers the where it is given, so the two clauses the count relies
        // on -- stored ACTIVE and not a Demo -- are exercised rather than
        // assumed.
        findMany: async ({ where = {} }: { where?: { lifecycleStatus?: string; isDemo?: boolean } } = {}) =>
          campaigns
            .filter((c) => (where.lifecycleStatus === undefined || c.lifecycleStatus === where.lifecycleStatus))
            .filter((c) => (where.isDemo === undefined || c.isDemo === where.isDemo))
            .map(({ id, creatorId, lifecycleStatus, deadline }) => ({ id, creatorId, lifecycleStatus, deadline })),
      },
    };
  }

  it('counts a Fundraiser\'s Active Campaigns and nobody else\'s', async () => {
    const counts = await activeCampaignCountsByFundraiser(
      dbWith([
        { id: 'c1', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: FUTURE, isDemo: false },
        { id: 'c2', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: FUTURE, isDemo: false },
        { id: 'c3', creatorId: 'creator-2', lifecycleStatus: 'ACTIVE', deadline: FUTURE, isDemo: false },
      ]) as never,
      { now: NOW }
    );

    expect(counts.get('creator-1')).toBe(2);
    expect(counts.get('creator-2')).toBe(1);
  });

  it('counts a Campaign whose deadline has passed as no longer Active, and never a Demo one', async () => {
    const counts = await activeCampaignCountsByFundraiser(
      dbWith([
        { id: 'c1', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: PAST, isDemo: false },
        { id: 'c2', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: null, isDemo: true },
      ]) as never,
      { now: NOW }
    );

    expect(counts.get('creator-1')).toBeUndefined();
  });

  it('leaves out the Campaign a caller is about to open, so approving it does not count itself', async () => {
    const counts = await activeCampaignCountsByFundraiser(
      dbWith([
        { id: 'c1', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: FUTURE, isDemo: false },
        { id: 'c2', creatorId: 'creator-1', lifecycleStatus: 'ACTIVE', deadline: FUTURE, isDemo: false },
      ]) as never,
      { now: NOW, excludeCampaignId: 'c2' }
    );

    expect(counts.get('creator-1')).toBe(1);
  });
});
