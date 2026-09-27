import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ledgerFixture, makeImpactDb, type ImpactDbData } from '../../../../tests/support/in-memory-impact-db';

/**
 * The public Impact & Transparency breakdown (ticket 25; PRD FFI-14), served
 * to any visitor with no session. The assertions are the PRD's own: the six
 * lines must add up to exactly the amount collected, a refunded Donation is
 * still collected and appears as a returned line, and the money the platform
 * absorbs on a Refund is shown apart from the collected figure because it is
 * platform money, not the Donors'.
 *
 * Expected amounts are worked by hand from the leg shapes the fixtures post,
 * never recomputed the way the reader computes them.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-impact-db').makeImpactDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

import { GET } from './route';

function request(query = ''): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/impact${query}`));
}

async function getBreakdown(query = ''): Promise<Record<string, unknown>> {
  const response = await GET(request(query));
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

/** The six lines as `{ key: amount }`, so a test states a whole page of money compactly. */
function lines(body: Record<string, unknown>): Record<string, number> {
  const rows = body.lines as Array<{ key: string; amount: number }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.amount]));
}

function sumOf(values: Record<string, number>): number {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

const CAMPAIGN = { id: 'campaign-1', title: 'Pemulihan Gudang', isDemo: false, location: 'Jawa Barat' };

/** A campaign that settled one Donation of 100 000, never released from Escrow Hold. */
function settledOnly(overrides: Partial<ImpactDbData> = {}): Partial<ImpactDbData> {
  const ledger = ledgerFixture();
  ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
  return {
    campaigns: [CAMPAIGN],
    payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
    ledgerEntries: ledger.rows,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/impact -- the six lines add up to what was collected', () => {
  it('breaks one settled Donation into the six lines, in rupiah, from the ledger', async () => {
    // Gross 100 000, Provider Fee 3 000, Platform Fee 5 000, so 92 000 sits
    // in Escrow Hold. Nothing released, refunded or paid out yet.
    holder.db = makeImpactDb(settledOnly());

    const body = await getBreakdown();

    expect(body.collected).toBe(100_000);
    expect(lines(body)).toEqual({
      disbursedToFundraisers: 0,
      returnedToDonors: 0,
      heldInEscrowHold: 92_000,
      availableInCampaignBalance: 0,
      platformFeeRetained: 5_000,
      providerFeeKept: 3_000,
    });
  });

  it('always labels each line, so a page can render them without inventing names', async () => {
    holder.db = makeImpactDb(settledOnly());

    const rows = (await getBreakdown()).lines as Array<{ key: string; label: string; amount: number }>;

    expect(rows.map((r) => r.key)).toEqual([
      'disbursedToFundraisers',
      'returnedToDonors',
      'heldInEscrowHold',
      'availableInCampaignBalance',
      'platformFeeRetained',
      'providerFeeKept',
    ]);
    expect(rows.every((r) => r.label.trim().length > 0)).toBe(true);
  });

  it('counts a released Escrow Hold as available Campaign Balance rather than held money', async () => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.release({ paymentId: 'payment-1', campaignId: 'campaign-1', amount: 92_000 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      ledgerEntries: ledger.rows,
    });

    const body = lines(await getBreakdown());

    expect(body.heldInEscrowHold).toBe(0);
    expect(body.availableInCampaignBalance).toBe(92_000);
  });

  it('shows money already instructed to a Fundraiser as disbursed, and what is left as available', async () => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 0, platformFee: 0 });
    ledger.release({ paymentId: 'payment-1', campaignId: 'campaign-1', amount: 100_000 });
    ledger.payoutInstruction({ payoutId: 'payout-1', campaignId: 'campaign-1', amount: 60_000 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      payouts: [{ id: 'payout-1', campaignId: 'campaign-1', amount: 60_000, status: 'APPROVED' }],
      ledgerEntries: ledger.rows,
    });

    const body = lines(await getBreakdown());

    expect(body.disbursedToFundraisers).toBe(60_000);
    expect(body.availableInCampaignBalance).toBe(40_000);
  });

  it('reports the part of a disbursement not yet marked COMPLETED, without taking it out of the disbursed line', async () => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 0, platformFee: 0 });
    ledger.release({ paymentId: 'payment-1', campaignId: 'campaign-1', amount: 100_000 });
    ledger.payoutInstruction({ payoutId: 'payout-1', campaignId: 'campaign-1', amount: 60_000 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      payouts: [{ id: 'payout-1', campaignId: 'campaign-1', amount: 60_000, status: 'APPROVED' }],
      ledgerEntries: ledger.rows,
    });

    const body = await getBreakdown();

    expect(body.disbursedNotYetCompleted).toBe(60_000);
    expect(lines(body).disbursedToFundraisers).toBe(60_000);
  });
});

describe('GET /api/impact -- a refunded Donation', () => {
  /** Gross 100 000 refunded in full out of Escrow Hold, campaign-funded. */
  function refundedInFull(): Partial<ImpactDbData> {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    ledger.refundApproval({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      shortfall: 0,
    });
    return {
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      ledgerEntries: ledger.rows,
    };
  }

  it('still counts as collected and appears as a returned line', async () => {
    holder.db = makeImpactDb(refundedInFull());

    const body = lines(await getBreakdown());

    // The Donor's 100 000 went back, so nothing is left with the Campaign --
    // but the money did arrive, so it is still in "collected".
    expect(body.returnedToDonors).toBe(100_000);
    expect(body.heldInEscrowHold).toBe(0);
    expect(body.availableInCampaignBalance).toBe(0);
  });

  it('keeps the Provider Fee the platform absorbed out of the collected lines and reports it as platform cost', async () => {
    holder.db = makeImpactDb(refundedInFull());

    const raw = await getBreakdown();
    const body = lines(raw);

    // The provider never returns its 3 000 on a Gross refund (ADR 0007), so
    // the platform carried it: it is not money the provider still holds, and
    // it is not part of what the Donors collected either.
    expect(body.providerFeeKept).toBe(0);
    expect(body.platformFeeRetained).toBe(0);
    expect(raw.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 0 });
  });

  it('holds a Refund that has not been paid out yet as frozen money, still inside collected', async () => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      ledgerEntries: ledger.rows,
    });

    const body = lines(await getBreakdown());

    expect(body.heldInEscrowHold).toBe(100_000);
    expect(body.returnedToDonors).toBe(0);
  });

  it('still totals the collected figure after a Refund that returns BOTH fees, and after that Refund is paid out', async () => {
    // prd-compliance 28c. A fee that was counted into a line and then handed
    // back has to leave the page the same way it arrived, or the six lines
    // stop being a conservation law. The Provider Balance leg that pays the
    // Refund is the one that could have broken it, since it moves the same
    // money the page already reports as returned.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    ledger.refundApproval({ refundId: 'refund-1', campaignId: 'campaign-1', amount: 100_000, source: 'ESCROW_HOLD', shortfall: 0 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      ledgerEntries: ledger.rows,
    });

    const approved = await getBreakdown();

    expect(approved.collected).toBe(100_000);
    expect(sumOf(lines(approved))).toBe(100_000);
    // Both fees left the page with the refund: 3 000 the provider never
    // returned, 5 000 of platform fee given back, and the platform's cost is
    // reported beside the lines rather than inside them.
    expect(lines(approved)).toEqual({
      disbursedToFundraisers: 0,
      returnedToDonors: 100_000,
      heldInEscrowHold: 0,
      availableInCampaignBalance: 0,
      platformFeeRetained: 0,
      providerFeeKept: 0,
    });
    expect(approved.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 0 });

    // Now the Donor is actually paid, which drains the Provider Balance. The
    // page must not move by a single rupiah: the money was already reported
    // as returned when the Refund was approved.
    ledger.refundPayment({ refundId: 'refund-1', amount: 100_000 });
    const paid = await getBreakdown();

    expect(paid.collected).toBe(100_000);
    expect(lines(paid)).toEqual(lines(approved));
    expect(sumOf(lines(paid))).toBe(100_000);
  });

  it('a Refund the Campaign could no longer cover does not shrink the disbursed line -- it is platform cost', async () => {    // The Campaign was paid out in full, so the 100 000 Gross refund finds an
    // empty balance: 92 000 of it is a shortfall the platform covered.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.release({ paymentId: 'payment-1', campaignId: 'campaign-1', amount: 92_000 });
    ledger.payoutInstruction({ payoutId: 'payout-1', campaignId: 'campaign-1', amount: 92_000 });
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'CAMPAIGN_BALANCE',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    ledger.refundApproval({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'CAMPAIGN_BALANCE',
      shortfall: 92_000,
    });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      payouts: [{ id: 'payout-1', campaignId: 'campaign-1', amount: 92_000, status: 'APPROVED' }],
      ledgerEntries: ledger.rows,
    });

    const raw = await getBreakdown();
    const body = lines(raw);

    expect(body.disbursedToFundraisers).toBe(92_000);
    // 100 000 returned, of which 92 000 never belonged to the Campaign: that
    // part is the platform's loss, shown apart from the collected figure.
    expect(body.returnedToDonors).toBe(8_000);
    expect(raw.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 92_000 });
  });
});

describe('GET /api/impact -- who the money is for, and what the page must not claim', () => {
  it('leaves a Demo Campaign out of every figure, including the collected total', async () => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-demo', campaignId: 'campaign-demo', gross: 25_000_000, providerFee: 0, platformFee: 0 });
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    holder.db = makeImpactDb({
      campaigns: [
        { id: 'campaign-demo', title: 'Bantu korban bencana (contoh)', isDemo: true, location: 'Jawa Barat' },
        CAMPAIGN,
      ],
      payments: [
        { id: 'payment-demo', campaignId: 'campaign-demo' },
        { id: 'payment-1', campaignId: 'campaign-1' },
      ],
      ledgerEntries: ledger.rows,
    });

    const raw = await getBreakdown();

    expect(raw.collected).toBe(100_000);
    expect(sumOf(lines(raw))).toBe(100_000);
  });

  it('reads zero beneficiaries until Usage Reports exist, and says why in the payload', async () => {
    holder.db = makeImpactDb(settledOnly());

    const body = await getBreakdown();

    expect(body.beneficiaries).toBe(0);
    expect((body.notes as string[]).some((note) => note.includes('Usage Report'))).toBe(true);
  });

  it('fails loudly rather than answering with numbers that do not reconcile', async () => {
    // A Payout instructed out of a Campaign that never settled a Payment --
    // money that left the platform with no Donation behind it. The six lines
    // cannot account for it, so nothing is served.
    const ledger = ledgerFixture();
    ledger.raw([
      { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 500_000 },
      { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 500_000, campaignId: 'campaign-1' },
    ]);
    ledger.payoutInstruction({ payoutId: 'payout-1', campaignId: 'campaign-1', amount: 500_000 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payouts: [{ id: 'payout-1', campaignId: 'campaign-1', amount: 500_000, status: 'APPROVED' }],
      ledgerEntries: ledger.rows,
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('impact-tidak-rekonsiliasi');
    // The figures themselves never reach the visitor: a number that cannot be
    // accounted for is worse than no number at all.
    expect(body).not.toHaveProperty('lines');
    expect(body).not.toHaveProperty('collected');
  });
});

describe('GET /api/impact -- filtering by location', () => {
  beforeEach(() => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 0, platformFee: 0 });
    ledger.settle({ paymentId: 'payment-2', campaignId: 'campaign-2', gross: 500_000, providerFee: 0, platformFee: 0 });
    holder.db = makeImpactDb({
      campaigns: [
        CAMPAIGN,
        { id: 'campaign-2', title: 'Beasiswa Anak Pesisir', isDemo: false, location: 'Bali' },
      ],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1' },
        { id: 'payment-2', campaignId: 'campaign-2' },
      ],
      ledgerEntries: ledger.rows,
    });
  });

  it('counts every Campaign when no location is asked for', async () => {
    const raw = await getBreakdown();

    expect(raw.collected).toBe(600_000);
    expect(raw.location).toBeNull();
  });

  it('counts only the Campaigns in that location, matching part of the name', async () => {
    const raw = await getBreakdown('?location=jawa');

    expect(raw.location).toBe('jawa');
    expect(raw.collected).toBe(100_000);
    expect(sumOf(lines(raw))).toBe(100_000);
  });

  it('answers zero, not everything, for a location no Campaign records', async () => {
    const raw = await getBreakdown('?location=Kalimantan');

    expect(raw.collected).toBe(0);
    expect(sumOf(lines(raw))).toBe(0);
  });
});
