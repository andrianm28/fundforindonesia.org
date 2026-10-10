import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  countedPaymentWhere,
  isCountedPayment,
  currentPaymentSandboxStamp,
  testDonationAmountForCampaign,
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

  it('leaves sandbox Payments out even while the marker is on', () => {
    expect(countedPaymentWhere()).toEqual({ sandbox: false });
    expect(isCountedPayment({ sandbox: true })).toBe(false);
    expect(isCountedPayment({ sandbox: false })).toBe(true);
  });

  it('stamps new Payments as sandbox', () => {
    expect(currentPaymentSandboxStamp()).toBe(true);
  });

  it('subtracts beta Gross from the public Campaign figure just as live does', async () => {
    const db = { payment: { findMany: vi.fn().mockResolvedValue([{ amount: 40, donation: { campaignId: 'c1' } }]) } };

    const [row] = await withCountedCollectedAmount(db as never, [{ id: 'c1', collectedAmount: 500 }]);

    expect(row.collectedAmount).toBe(460);
  });

  it('reports "Donasi uji" for a Campaign: the sandbox Gross, zero when there is none', async () => {
    const db = { payment: { findMany: vi.fn().mockResolvedValue([{ amount: 40, donation: { campaignId: 'c1' } }]) } };

    expect(await testDonationAmountForCampaign(db as never, 'c1')).toBe(40);
    expect(await testDonationAmountForCampaign(db as never, 'c2')).toBe(0);
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

  it('reports no "Donasi uji" and does not query for it', async () => {
    const db = { payment: { findMany: vi.fn() } };

    expect(await testDonationAmountForCampaign(db as never, 'c1')).toBeNull();
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });

  it('reads a near-miss marker as live: no "Donasi uji" line', async () => {
    process.env.BETA_SANDBOX = 'TRUE';
    const db = { payment: { findMany: vi.fn() } };

    expect(await testDonationAmountForCampaign(db as never, 'c1')).toBeNull();
  });

  it('subtracts the Gross of every settled sandbox Payment, refunded ones included, from the stored Campaign counter', async () => {
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
        // REFUNDED too: a full Refund never decrements the lifetime counter, so a
        // beta Payment refunded in full is still inside it.
        where: {
          status: { in: ['PAID', 'REFUNDED'] },
          sandbox: true,
          donation: { campaignId: { in: ['c1', 'c2', 'c3'] } },
        },
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
