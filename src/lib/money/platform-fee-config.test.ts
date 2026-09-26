import { describe, it, expect, vi } from 'vitest';
import {
  resolvePlatformFeeBasis,
  resolvePlatformFeeBasisForCampaign,
  setPlatformFeeRule,
  setPlatformFeeThreshold,
  InvalidPlatformFeeRuleError,
} from './platform-fee-config';

/**
 * Fee resolution against Campaign/Category/Kind, and the append-only writes
 * an Admin makes (prd-compliance 17). Standalone in-memory Prisma stand-in,
 * in the style of ledger.test.ts's makeTx -- this module touches exactly two
 * tables, so a shared fixture buys nothing here.
 */

type RuleRow = {
  id: string;
  scope: 'KIND' | 'CATEGORY' | 'CAMPAIGN';
  kind: string | null;
  category: string | null;
  campaignId: string | null;
  percentBps: number;
  setById: string;
  setAt: Date;
};

type ThresholdRow = { id: string; amount: number; setById: string; setAt: Date };

function makeDb(seed: { rules?: RuleRow[]; thresholds?: ThresholdRow[] } = {}) {
  const rules: RuleRow[] = [...(seed.rules ?? [])];
  const thresholds: ThresholdRow[] = [...(seed.thresholds ?? [])];
  let nextId = 1;

  return {
    rules,
    thresholds,
    platformFeeRule: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const matches = rules.filter((r) =>
          Object.entries(where).every(([k, v]) => (r as never as Record<string, unknown>)[k] === v),
        );
        if (matches.length === 0) return null;
        return matches.slice().sort((a, b) => b.setAt.getTime() - a.setAt.getTime())[0];
      }),
      create: vi.fn(async ({ data }: { data: Omit<RuleRow, 'id' | 'setAt'> & { setAt?: Date } }) => {
        const row: RuleRow = { id: `rule-${nextId++}`, setAt: new Date(), ...data };
        rules.push(row);
        return row;
      }),
    },
    platformFeeThreshold: {
      findFirst: vi.fn(async () => {
        if (thresholds.length === 0) return null;
        return thresholds.slice().sort((a, b) => b.setAt.getTime() - a.setAt.getTime())[0];
      }),
      create: vi.fn(async ({ data }: { data: Omit<ThresholdRow, 'id' | 'setAt'> & { setAt?: Date } }) => {
        const row: ThresholdRow = { id: `threshold-${nextId++}`, setAt: new Date(), ...data };
        thresholds.push(row);
        return row;
      }),
    },
  };
}

describe('resolvePlatformFeeBasis', () => {
  it('reads 0 percentBps and 0 threshold when nothing has been configured', async () => {
    const db = makeDb();

    const basis = await resolvePlatformFeeBasis(db as never, {
      kind: 'DONATION' as never,
      category: 'kesehatan',
      campaignId: 'campaign-1',
    });

    expect(basis).toEqual({ percentBps: 0, thresholdAmount: 0 });
  });

  it('falls back to the Kind default when no Category or Campaign override exists', async () => {
    const db = makeDb({
      rules: [
        { id: 'r1', scope: 'KIND', kind: 'DONATION', category: null, campaignId: null, percentBps: 250, setById: 'admin-1', setAt: new Date('2026-01-01') },
      ],
    });

    const basis = await resolvePlatformFeeBasis(db as never, {
      kind: 'DONATION' as never,
      category: 'kesehatan',
      campaignId: 'campaign-1',
    });

    expect(basis.percentBps).toBe(250);
  });

  it('prefers the Category override over the Kind default', async () => {
    const db = makeDb({
      rules: [
        { id: 'r1', scope: 'KIND', kind: 'DONATION', category: null, campaignId: null, percentBps: 250, setById: 'admin-1', setAt: new Date('2026-01-01') },
        { id: 'r2', scope: 'CATEGORY', kind: null, category: 'kesehatan', campaignId: null, percentBps: 300, setById: 'admin-1', setAt: new Date('2026-01-02') },
      ],
    });

    const basis = await resolvePlatformFeeBasis(db as never, {
      kind: 'DONATION' as never,
      category: 'kesehatan',
      campaignId: 'campaign-1',
    });

    expect(basis.percentBps).toBe(300);
  });

  it('prefers the Campaign override over both Category and Kind', async () => {
    const db = makeDb({
      rules: [
        { id: 'r1', scope: 'KIND', kind: 'DONATION', category: null, campaignId: null, percentBps: 250, setById: 'admin-1', setAt: new Date('2026-01-01') },
        { id: 'r2', scope: 'CATEGORY', kind: null, category: 'kesehatan', campaignId: null, percentBps: 300, setById: 'admin-1', setAt: new Date('2026-01-02') },
        { id: 'r3', scope: 'CAMPAIGN', kind: null, category: null, campaignId: 'campaign-1', percentBps: 0, setById: 'admin-1', setAt: new Date('2026-01-03') },
      ],
    });

    const basis = await resolvePlatformFeeBasis(db as never, {
      kind: 'DONATION' as never,
      category: 'kesehatan',
      campaignId: 'campaign-1',
    });

    expect(basis.percentBps).toBe(0);
  });

  it('uses the LATEST rule for a scope+key, ignoring superseded ones', async () => {
    const db = makeDb({
      rules: [
        { id: 'r1', scope: 'KIND', kind: 'DONATION', category: null, campaignId: null, percentBps: 250, setById: 'admin-1', setAt: new Date('2026-01-01') },
        { id: 'r2', scope: 'KIND', kind: 'DONATION', category: null, campaignId: null, percentBps: 400, setById: 'admin-2', setAt: new Date('2026-02-01') },
      ],
    });

    const basis = await resolvePlatformFeeBasis(db as never, {
      kind: 'DONATION' as never,
      category: 'kesehatan',
      campaignId: 'campaign-1',
    });

    expect(basis.percentBps).toBe(400);
  });

  it('reads the latest threshold', async () => {
    const db = makeDb({
      thresholds: [
        { id: 't1', amount: 20_000, setById: 'admin-1', setAt: new Date('2026-01-01') },
        { id: 't2', amount: 50_000, setById: 'admin-2', setAt: new Date('2026-02-01') },
      ],
    });

    const basis = await resolvePlatformFeeBasis(db as never, {
      kind: 'DONATION' as never,
      category: 'kesehatan',
      campaignId: 'campaign-1',
    });

    expect(basis.thresholdAmount).toBe(50_000);
  });
});

describe('resolvePlatformFeeBasisForCampaign', () => {
  it('resolves the same as resolvePlatformFeeBasis, from a Campaign row', async () => {
    const db = makeDb({
      rules: [
        { id: 'r1', scope: 'KIND', kind: 'DONATION', category: null, campaignId: null, percentBps: 250, setById: 'admin-1', setAt: new Date('2026-01-01') },
      ],
    });

    const basis = await resolvePlatformFeeBasisForCampaign(db as never, {
      id: 'campaign-1',
      kind: 'DONATION' as never,
      category: 'kesehatan',
    });

    expect(basis.percentBps).toBe(250);
  });
});

describe('setPlatformFeeRule', () => {
  it('records who and when by inserting a new row, never mutating an old one', async () => {
    const db = makeDb();

    await setPlatformFeeRule(db as never, { scope: 'KIND', kind: 'DONATION' as never, percentBps: 250, actorId: 'admin-1' });
    await setPlatformFeeRule(db as never, { scope: 'KIND', kind: 'DONATION' as never, percentBps: 400, actorId: 'admin-2' });

    expect(db.rules).toHaveLength(2);
    expect(db.rules[0]).toMatchObject({ percentBps: 250, setById: 'admin-1' });
    expect(db.rules[1]).toMatchObject({ percentBps: 400, setById: 'admin-2' });
  });

  it('refuses scope KIND with no kind', async () => {
    const db = makeDb();
    await expect(
      setPlatformFeeRule(db as never, { scope: 'KIND', percentBps: 250, actorId: 'admin-1' }),
    ).rejects.toThrow(InvalidPlatformFeeRuleError);
  });

  it('refuses scope CATEGORY with no category', async () => {
    const db = makeDb();
    await expect(
      setPlatformFeeRule(db as never, { scope: 'CATEGORY', percentBps: 250, actorId: 'admin-1' }),
    ).rejects.toThrow(InvalidPlatformFeeRuleError);
  });

  it('refuses scope CAMPAIGN with no campaignId', async () => {
    const db = makeDb();
    await expect(
      setPlatformFeeRule(db as never, { scope: 'CAMPAIGN', percentBps: 250, actorId: 'admin-1' }),
    ).rejects.toThrow(InvalidPlatformFeeRuleError);
  });

  it('refuses a percentBps above 100% (10_000 bps)', async () => {
    const db = makeDb();
    await expect(
      setPlatformFeeRule(db as never, { scope: 'KIND', kind: 'DONATION' as never, percentBps: 10_001, actorId: 'admin-1' }),
    ).rejects.toThrow(InvalidPlatformFeeRuleError);
  });

  it('refuses a negative percentBps', async () => {
    const db = makeDb();
    await expect(
      setPlatformFeeRule(db as never, { scope: 'KIND', kind: 'DONATION' as never, percentBps: -1, actorId: 'admin-1' }),
    ).rejects.toThrow(InvalidPlatformFeeRuleError);
  });
});

describe('setPlatformFeeThreshold', () => {
  it('records who and when by inserting a new row', async () => {
    const db = makeDb();

    await setPlatformFeeThreshold(db as never, { amount: 50_000, actorId: 'admin-1' });

    expect(db.thresholds).toHaveLength(1);
    expect(db.thresholds[0]).toMatchObject({ amount: 50_000, setById: 'admin-1' });
  });

  it('refuses a negative amount', async () => {
    const db = makeDb();
    await expect(
      setPlatformFeeThreshold(db as never, { amount: -1, actorId: 'admin-1' }),
    ).rejects.toThrow(InvalidPlatformFeeRuleError);
  });

  it('refuses a non-integer amount', async () => {
    const db = makeDb();
    await expect(
      setPlatformFeeThreshold(db as never, { amount: 50_000.5, actorId: 'admin-1' }),
    ).rejects.toThrow(InvalidPlatformFeeRuleError);
  });
});
