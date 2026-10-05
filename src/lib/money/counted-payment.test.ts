import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  countedPaymentWhere,
  isCountedPayment,
  currentPaymentSandboxStamp,
  uncountedGrossByCampaign,
  withCountedCollectedAmount,
} from './counted-payment';

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.BETA_SANDBOX;
  delete process.env.BETA_SANDBOX;
});

afterEach(() => {
  if (saved === undefined) delete process.env.BETA_SANDBOX;
  else process.env.BETA_SANDBOX = saved;
});

describe('"Payment yang dihitung" in the beta', () => {
  beforeEach(() => {
    process.env.BETA_SANDBOX = 'true';
  });

  it('counts every Payment, sandbox or not', () => {
    expect(countedPaymentWhere()).toEqual({});
    expect(isCountedPayment({ sandbox: true })).toBe(true);
    expect(isCountedPayment({ sandbox: false })).toBe(true);
  });

  it('stamps new Payments as sandbox', () => {
    expect(currentPaymentSandboxStamp()).toBe(true);
  });

  it('subtracts nothing from a Campaign figure, and does not even query', async () => {
    const db = { payment: { findMany: vi.fn() } };
    const rows = [{ id: 'c1', collectedAmount: 500 }];

    expect(await withCountedCollectedAmount(db as never, rows)).toBe(rows);
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
});

describe('"Payment yang dihitung" live', () => {
  it('leaves sandbox-stamped Payments out', () => {
    expect(countedPaymentWhere()).toEqual({ sandbox: false });
    expect(isCountedPayment({ sandbox: true })).toBe(false);
    expect(isCountedPayment({ sandbox: false })).toBe(true);
  });

  it('stamps new Payments as live', () => {
    expect(currentPaymentSandboxStamp()).toBe(false);
  });

  it('reads a near-miss marker as live, so beta rows stay out', () => {
    process.env.BETA_SANDBOX = 'TRUE';
    expect(countedPaymentWhere()).toEqual({ sandbox: false });
    expect(isCountedPayment({ sandbox: true })).toBe(false);
  });

  it('subtracts the Gross of PAID sandbox Payments from the stored Campaign counter', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { amount: 100_000, donation: { campaignId: 'c1' } },
      { amount: 50_000, donation: { campaignId: 'c1' } },
      { amount: 20_000, donation: { campaignId: 'c2' } },
      { amount: 9_000, donation: null },
    ]);
    const db = { payment: { findMany } };

    const rows = await withCountedCollectedAmount(db as never, [
      { id: 'c1', collectedAmount: 400_000, title: 'a' },
      { id: 'c2', collectedAmount: 20_000, title: 'b' },
      { id: 'c3', collectedAmount: 7_000, title: 'c' },
    ]);

    expect(rows).toEqual([
      { id: 'c1', collectedAmount: 250_000, title: 'a' },
      { id: 'c2', collectedAmount: 0, title: 'b' },
      { id: 'c3', collectedAmount: 7_000, title: 'c' },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PAID', sandbox: true, donation: { campaignId: { in: ['c1', 'c2', 'c3'] } } },
      }),
    );
  });

  it('never reports a negative figure', async () => {
    const db = { payment: { findMany: vi.fn().mockResolvedValue([{ amount: 900, donation: { campaignId: 'c1' } }]) } };

    const [row] = await withCountedCollectedAmount(db as never, [{ id: 'c1', collectedAmount: 100 }]);

    expect(row.collectedAmount).toBe(0);
  });

  it('answers an empty map without querying when there are no Campaigns', async () => {
    const db = { payment: { findMany: vi.fn() } };

    expect((await uncountedGrossByCampaign(db as never, [])).size).toBe(0);
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });
});
