import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Kind } from '@/generated/prisma/client';
import { readDonorRefundConfig } from './donor-refund-config';

const createRefund = vi.hoisted(() => vi.fn());
vi.mock('./refunds', () => ({ createRefund }));
vi.mock('@/lib/subject-guard', () => ({ lockAndLoad: vi.fn().mockResolvedValue({ kind: 'campaign' }) }));

import { requestDonorRefund, isDonorInitiatedRefund } from './donor-refunds';
import { DonorRefundDisabledError, DonorRefundNotEligibleError, DonorRefundTooManyOpenError } from './donor-refund-errors';

// Test-only values. The real ones live in the deployment environment.
const ENV = {
  DONOR_REFUND_WINDOW_HOURS: '10',
  DONOR_REFUND_MAX_OPEN_PER_DONOR: '2',
  DONOR_REFUND_MAX_AMOUNT_DONATION: '500000',
  DONOR_REFUND_MAX_AMOUNT_ZAKAT: '300000',
};
const NOW = new Date('2026-10-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function makePrisma(
  options: {
    donorId?: string | null;
    kind?: Kind;
    settledAt?: Date | null;
    paid?: boolean;
    anonymisedAt?: Date | null;
    payoutsDrawn?: number;
    openRefunds?: number;
  } = {},
) {
  const payoutCount = vi.fn().mockResolvedValue(options.payoutsDrawn ?? 0);
  const refundCount = vi.fn().mockResolvedValue(options.openRefunds ?? 0);
  const tx = {
    donation: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'don-1',
        donorId: options.donorId === undefined ? 'donor-1' : options.donorId,
        campaignId: 'camp-1',
        anonymisedAt: options.anonymisedAt ?? null,
        campaign: { kind: options.kind ?? Kind.DONATION },
        payments:
          options.paid === false ? [] : [{ id: 'pay-1', amount: 400_000, settledAt: options.settledAt === undefined ? hoursAgo(2) : options.settledAt }],
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    payout: { count: payoutCount },
    refund: { count: refundCount },
  };
  const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma, tx, payoutCount, refundCount };
}

const params = { donorId: 'donor-1', donationId: 'don-1', amount: 100_000, reason: 'Salah nominal', now: NOW, env: ENV };

beforeEach(() => {
  createRefund.mockReset();
  createRefund.mockResolvedValue({ id: 'refund-1', status: 'REQUESTED' });
});

describe('readDonorRefundConfig', () => {
  it('is off (null) when nothing is set: there is no hidden default', () => {
    expect(readDonorRefundConfig({})).toBeNull();
  });

  it('is off when the window or the open limit is missing or not a positive whole number', () => {
    for (const bad of ['', '0', '-1', '1.5', '1e3', 'abc', ' 5']) {
      expect(readDonorRefundConfig({ ...ENV, DONOR_REFUND_WINDOW_HOURS: bad })).toBeNull();
      expect(readDonorRefundConfig({ ...ENV, DONOR_REFUND_MAX_OPEN_PER_DONOR: bad })).toBeNull();
    }
  });

  it('allows only the Kinds with a valid cap', () => {
    const config = readDonorRefundConfig({ ...ENV, DONOR_REFUND_MAX_AMOUNT_WAKAF: 'banyak' });
    expect(config?.maxAmountByKind).toEqual({ DONATION: 500_000, ZAKAT: 300_000 });
  });
});

describe('requestDonorRefund', () => {
  it('creates the Refund through createRefund as the Donor, in the Campaign subject', async () => {
    const { prisma, tx } = makePrisma();

    const refund = await requestDonorRefund(prisma as never, params);

    expect(refund.id).toBe('refund-1');
    expect(createRefund).toHaveBeenCalledWith(tx, {
      subject: { type: 'campaign', campaignId: 'camp-1' },
      paymentId: 'pay-1',
      amount: 100_000,
      reason: 'Salah nominal',
      requestedById: 'donor-1',
    });
  });

  it('is refused when the feature is off, without touching the database', async () => {
    const { prisma } = makePrisma();
    await expect(requestDonorRefund(prisma as never, { ...params, env: {} })).rejects.toBeInstanceOf(DonorRefundDisabledError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("refuses somebody else's Donation, a guest Donation as not found", async () => {
    for (const options of [{ donorId: 'someone-else' }, { donorId: null }]) {
      const { prisma } = makePrisma(options);
      await expect(requestDonorRefund(prisma as never, params)).rejects.toMatchObject({ reason: 'NOT_OWNER' });
    }
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('refuses a Donation whose Payment has not settled', async () => {
    const { prisma } = makePrisma({ paid: false });
    await expect(requestDonorRefund(prisma as never, params)).rejects.toMatchObject({ code: 'PAYMENT_NOT_PAID' });
    expect(createRefund).not.toHaveBeenCalled();
  });

  describe('time window', () => {
    it('allows a request inside the window and exactly at its edge', async () => {
      await requestDonorRefund(makePrisma({ settledAt: hoursAgo(9) }).prisma as never, params);
      await requestDonorRefund(makePrisma({ settledAt: hoursAgo(10) }).prisma as never, params);
      expect(createRefund).toHaveBeenCalledTimes(2);
    });

    it('refuses a request past the window', async () => {
      const { prisma } = makePrisma({ settledAt: hoursAgo(10.01) });
      await expect(requestDonorRefund(prisma as never, params)).rejects.toMatchObject({ reason: 'WINDOW_CLOSED' });
      expect(createRefund).not.toHaveBeenCalled();
    });

    it('refuses when settledAt is unknown: the window cannot be shown to be open', async () => {
      const { prisma } = makePrisma({ settledAt: null });
      await expect(requestDonorRefund(prisma as never, params)).rejects.toMatchObject({ reason: 'WINDOW_CLOSED' });
    });
  });

  describe('before any Payout', () => {
    it('asks only about Payouts that still hold or already took money from the Campaign', async () => {
      const { prisma, payoutCount } = makePrisma();
      await requestDonorRefund(prisma as never, params);
      expect(payoutCount).toHaveBeenCalledWith({
        where: { campaignId: 'camp-1', status: { in: ['SUBMITTED', 'APPROVED', 'PROCESSING', 'COMPLETED'] } },
      });
    });

    it('refuses once such a Payout exists, whatever the Donation amount', async () => {
      const { prisma } = makePrisma({ payoutsDrawn: 1 });
      await expect(requestDonorRefund(prisma as never, params)).rejects.toMatchObject({ reason: 'PAYOUT_ALREADY_DREW' });
      expect(createRefund).not.toHaveBeenCalled();
    });
  });

  describe('limit per Kind', () => {
    it('allows an amount equal to the cap and refuses one rupiah more', async () => {
      await requestDonorRefund(makePrisma().prisma as never, { ...params, amount: 500_000 });
      // The Payment is only 400_000 here, but the cap is judged before createRefund's own remaining check.
      await expect(requestDonorRefund(makePrisma().prisma as never, { ...params, amount: 500_001 })).rejects.toMatchObject({
        reason: 'AMOUNT_OVER_LIMIT',
      });
    });

    it('uses the cap of the Campaign Kind', async () => {
      const { prisma } = makePrisma({ kind: Kind.ZAKAT });
      await expect(requestDonorRefund(prisma as never, { ...params, amount: 300_001 })).rejects.toMatchObject({
        reason: 'AMOUNT_OVER_LIMIT',
      });
    });

    it('refuses a Kind with no cap configured', async () => {
      const { prisma } = makePrisma({ kind: Kind.WAKAF });
      await expect(requestDonorRefund(prisma as never, params)).rejects.toMatchObject({ reason: 'KIND_NOT_ALLOWED' });
      expect(createRefund).not.toHaveBeenCalled();
    });

    it('refuses a non-positive or fractional amount', async () => {
      for (const amount of [0, -5, 1.5, Number.NaN]) {
        await expect(requestDonorRefund(makePrisma().prisma as never, { ...params, amount })).rejects.toMatchObject({
          reason: 'AMOUNT_INVALID',
        });
      }
    });
  });

  describe('open requests per Donor', () => {
    it('counts the Donor’s own Refunds that are still waiting or in flight', async () => {
      const { prisma, refundCount } = makePrisma();
      await requestDonorRefund(prisma as never, params);
      expect(refundCount).toHaveBeenCalledWith({
        where: { requestedById: 'donor-1', status: { in: ['REQUESTED', 'AWAITING_DONOR_DETAILS', 'APPROVED', 'PROCESSING'] } },
      });
    });

    it('refuses when the Donor is at the limit and allows one below it', async () => {
      await requestDonorRefund(makePrisma({ openRefunds: 1 }).prisma as never, params);
      await expect(requestDonorRefund(makePrisma({ openRefunds: 2 }).prisma as never, params)).rejects.toBeInstanceOf(
        DonorRefundTooManyOpenError,
      );
    });
  });

  it('records the Donor’s reason as given but refuses a blank one', async () => {
    await expect(requestDonorRefund(makePrisma().prisma as never, { ...params, reason: '   ' })).rejects.toMatchObject({
      code: 'REFUND_REASON_INVALID',
    });
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('refusals are DonorRefundNotEligibleError carrying no configured number in the message', async () => {
    const { prisma } = makePrisma({ settledAt: hoursAgo(50) });
    const error = await requestDonorRefund(prisma as never, params).catch((e) => e);
    expect(error).toBeInstanceOf(DonorRefundNotEligibleError);
    expect(error.message).not.toMatch(/\d/);
  });
});

describe('isDonorInitiatedRefund', () => {
  it('is true only when the requester is the Donor of the Payment’s Donation', () => {
    expect(isDonorInitiatedRefund({ requestedById: 'donor-1', payment: { donation: { donorId: 'donor-1' } } })).toBe(true);
    expect(isDonorInitiatedRefund({ requestedById: 'admin-1', payment: { donation: { donorId: 'donor-1' } } })).toBe(false);
    expect(isDonorInitiatedRefund({ requestedById: 'admin-1', payment: { donation: null } })).toBe(false);
    expect(isDonorInitiatedRefund({ requestedById: 'admin-1', payment: { donation: { donorId: null } } })).toBe(false);
  });
});
