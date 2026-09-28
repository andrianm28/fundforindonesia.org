import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { manualContributionReceivedLegs } from '@/lib/money/ledger';
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

/**
 * How a page moved from one state to the next, per line. Asserted on the
 * DELTA rather than on the end state alone, because the delta is what says a
 * movement happened at all: a page that reported the same numbers before and
 * after a fee came back would satisfy an end-state assertion while proving
 * nothing about where the fee went.
 */
function diffOf(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
}

/** Zero for every line, so a test can name only the ones it expects to move. */
function noLineMoved(): Record<string, number> {
  return {
    disbursedToFundraisers: 0,
    returnedToDonors: 0,
    heldInEscrowHold: 0,
    availableInCampaignBalance: 0,
    platformFeeRetained: 0,
    providerFeeKept: 0,
  };
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

  it('moves the page when a Refund returns BOTH fees, and stops moving once the Donor is paid', async () => {
    // prd-compliance 28c. This walks the page through all four states of one
    // Refund's life and asserts what each step does to the six lines, because
    // the step 28c added is a MOVEMENT and an end-state assertion alone would
    // not notice it happening.
    //
    // WHAT THE PAGE SHOULD DO, stated first because the numbers below only
    // mean something next to it. A fee that was counted into a line and then
    // handed back has to leave the page the same way it arrived, or the six
    // lines stop being a conservation law. So across the whole trace:
    //
    //   collected never moves (it is the Gross the Donors paid, a fact about
    //     settlements, and a Refund does not un-collect a rupiah), and
    //   the six lines total it at EVERY step, not just at the end.
    //
    // And the movement is real, not zero: freezing the Refund takes the
    // Campaign's net share out of the pool and puts the WHOLE Gross into
    // Frozen Balance, so the returned Platform Fee leaves
    // `platformFeeRetained`, the Provider Fee the provider will not return
    // leaves `providerFeeKept`, and `heldInEscrowHold` grows by exactly those
    // two amounts. A fee returned to the wrong account would leave the same
    // total -- every ledger transaction balances, so the conservation law
    // cannot tell -- and the wrong LINE. Which is why each step below asserts
    // the delta and not only the figures.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      ledgerEntries: ledger.rows,
    });

    // 1. Settled, untouched: the three-way split of the Gross.
    const settled = await getBreakdown();
    expect(settled.collected).toBe(100_000);
    expect(lines(settled)).toEqual({
      disbursedToFundraisers: 0,
      returnedToDonors: 0,
      heldInEscrowHold: 92_000,
      availableInCampaignBalance: 0,
      platformFeeRetained: 5_000,
      providerFeeKept: 3_000,
    });
    expect(settled.platformCost).toEqual({ unrecoveredProviderFee: 0, uncoveredRefunds: 0 });

    // 2. The Refund is created and the money freezes. Both fees leave their
    //    lines -- 5 000 handed back to the Donor's benefit, 3 000 the provider
    //    will not return and the platform carries -- and the frozen pot grows
    //    by their 8 000, so the page still totals 100 000.
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    const frozen = await getBreakdown();

    expect(frozen.collected).toBe(100_000);
    expect(sumOf(lines(frozen))).toBe(100_000);
    expect(diffOf(lines(settled), lines(frozen))).toEqual({
      ...noLineMoved(),
      heldInEscrowHold: 8_000,
      platformFeeRetained: -5_000,
      providerFeeKept: -3_000,
    });
    expect(lines(frozen)).toEqual({
      disbursedToFundraisers: 0,
      returnedToDonors: 0,
      heldInEscrowHold: 100_000,
      availableInCampaignBalance: 0,
      platformFeeRetained: 0,
      providerFeeKept: 0,
    });
    // The Provider Fee is now the platform's expense, so it leaves the six
    // lines entirely and is reported beside them.
    expect(frozen.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 0 });

    // 3. A second Admin approves it: the frozen Gross becomes a returned
    //    line, a straight handover rather than anything new.
    ledger.refundApproval({ refundId: 'refund-1', campaignId: 'campaign-1', amount: 100_000, source: 'ESCROW_HOLD', shortfall: 0 });
    const approved = await getBreakdown();

    expect(approved.collected).toBe(100_000);
    expect(sumOf(lines(approved))).toBe(100_000);
    expect(diffOf(lines(frozen), lines(approved))).toEqual({
      ...noLineMoved(),
      returnedToDonors: 100_000,
      heldInEscrowHold: -100_000,
    });
    expect(lines(approved)).toEqual({
      disbursedToFundraisers: 0,
      returnedToDonors: 100_000,
      heldInEscrowHold: 0,
      availableInCampaignBalance: 0,
      platformFeeRetained: 0,
      providerFeeKept: 0,
    });
    expect(approved.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 0 });

    // 4. The third Admin pays the Donor, which drains the Provider Balance.
    //    The page must not move by a single rupiah: the money was already
    //    reported as returned when the Refund was approved, and the Donor is
    //    being handed what the page has been showing since step 3.
    //
    //    HONESTLY, WHY "MUST NOT MOVE" IS A REAL CLAIM AND NOT A WEAK ONE:
    //    the Provider Balance is in NONE of the six lines. Settlement splits
    //    the Gross three ways (ESCROW_HOLD, PROVIDER_FEE, PLATFORM_FEE) and
    //    the pot only ever held it in transit, so no credit or debit here can
    //    reach a line. This test therefore proves the CONSERVATION LAW and the
    //    per-line destinations; it does NOT, and cannot, prove that the right
    //    account was drained -- posting that credit to PAYOUT_CLEARING
    //    instead leaves every one of these assertions green, because the
    //    reader filters that line by payoutId and a refund's legs carry a
    //    refundId. The pot's own identity is pinned where it can be seen:
    //    src/lib/money/ledger.test.ts asserts refundPaidLegs' exact legs and
    //    that GATEWAY_CLEARING + REFUND_COST equals what the pot is owed.
    //    Read this test as "the page is a conservation law, and a Refund
    //    moves it exactly twice", not as "the Provider Balance is drained
    //    correctly".
    ledger.refundPayment({ refundId: 'refund-1', amount: 100_000 });
    const paid = await getBreakdown();

    expect(paid.collected).toBe(100_000);
    expect(lines(paid)).toEqual(lines(approved));
    expect(diffOf(lines(approved), lines(paid))).toEqual(noLineMoved());
    expect(sumOf(lines(paid))).toBe(100_000);
    expect(paid.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 0 });
  });

  it('a Refund the Campaign could no longer cover does not shrink the disbursed line -- it is platform cost', async () => {
    // The Campaign was paid out in full, so the 100 000 Gross refund finds an
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

describe('GET /api/impact -- a Manual Contribution (prd-compliance 34, PRD FFI-14)', () => {
  it('counts it in the collected figure and in the available Campaign Balance, with no fee lines', async () => {
    // A 75 000 bank transfer into a Campaign that also took one 100 000
    // Donation (3 000 provider fee, 5 000 platform fee). Collected is the
    // Donation's gross plus the manual money -- there was no provider to
    // charge and no online gift to take a percentage of, so both arrive whole.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.manualContribution({ manualContributionId: 'mc-1', campaignId: 'campaign-1', amount: 75_000 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      ledgerEntries: ledger.rows,
    });

    const raw = await getBreakdown();

    expect(raw.collected).toBe(175_000);
    expect(lines(raw)).toEqual({
      disbursedToFundraisers: 0,
      returnedToDonors: 0,
      heldInEscrowHold: 92_000,
      availableInCampaignBalance: 75_000,
      platformFeeRetained: 5_000,
      providerFeeKept: 3_000,
    });
    // The lines still add up to what was collected, which is the whole
    // reason the manual money has to enter `collected` and not just the
    // available line: six numbers that do not reconcile are not served.
    expect(sumOf(lines(raw))).toBe(175_000);
  });

  it('marks it separately, so a visitor is told it is not a Donation', async () => {
    const ledger = ledgerFixture();
    ledger.manualContribution({ manualContributionId: 'mc-1', campaignId: 'campaign-1', amount: 75_000 });
    holder.db = makeImpactDb({ campaigns: [CAMPAIGN], ledgerEntries: ledger.rows });

    const raw = await getBreakdown();

    expect(raw.manualContributions).toBe(75_000);
  });

  it('drops a reversed contribution out of both the collected figure and the marker', async () => {
    // Recorded, then found to be the wrong rupiah and taken back out. The
    // money did arrive and did leave again, so counting it would overstate
    // what this Campaign holds; the reversal's own journal is what removes it,
    // not a status anyone has to remember to filter on.
    const ledger = ledgerFixture();
    ledger.manualContribution({ manualContributionId: 'mc-1', campaignId: 'campaign-1', amount: 75_000 });
    ledger.manualContributionReversal({ manualContributionId: 'mc-1', campaignId: 'campaign-1', amount: 75_000 });
    holder.db = makeImpactDb({ campaigns: [CAMPAIGN], ledgerEntries: ledger.rows });

    const raw = await getBreakdown();

    expect(raw.collected).toBe(0);
    expect(raw.manualContributions).toBe(0);
    expect(lines(raw).availableInCampaignBalance).toBe(0);
    expect(sumOf(lines(raw))).toBe(0);
  });

  it('leaves CSR money on a Program out of every Campaign figure', async () => {
    // A Program is not a Campaign, it has no page here, and FFI-14's CSR line
    // is a later ticket. Its money must not inflate a Campaign's collected
    // total -- nor break the reconciliation by appearing in a balance line
    // with no matching entry in `collected`.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 0, platformFee: 0 });
    ledger.raw(
      manualContributionReceivedLegs({ subject: { type: 'program', programId: 'program-1' }, amount: 500_000_000 }),
      { manualContributionId: 'mc-9' },
    );
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      ledgerEntries: ledger.rows,
    });

    const raw = await getBreakdown();

    expect(raw.collected).toBe(100_000);
    expect(raw.manualContributions).toBe(0);
    expect(sumOf(lines(raw))).toBe(100_000);
  });

  it('still leaves held escrow out of it -- a Manual Contribution never waits', async () => {
    const ledger = ledgerFixture();
    ledger.manualContribution({ manualContributionId: 'mc-1', campaignId: 'campaign-1', amount: 75_000 });
    holder.db = makeImpactDb({ campaigns: [CAMPAIGN], ledgerEntries: ledger.rows });

    const body = lines(await getBreakdown());

    expect(body.heldInEscrowHold).toBe(0);
    expect(body.availableInCampaignBalance).toBe(75_000);
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

/**
 * A withdrawal from the Provider Balance to the Collection Account
 * (prd-compliance 35) must leave this page completely alone, and that is a
 * claim about two subsystems agreeing rather than about either one working.
 *
 * The page's own assertion -- six lines summing exactly to `collected` -- is
 * what catches it if they ever stop agreeing. Both legs of a sweep are
 * platform-level and name no Payment, Refund, Payout or Campaign, so none of
 * the six lines has anything to read them from and the conservation law still
 * holds. If a future version of this movement acquired one of those, the sums
 * would go wrong and impact.ts would throw ImpactDoesNotReconcileError rather
 * than serving six numbers that do not add up.
 */
describe('GET /api/impact -- a sweep to the Collection Account (prd-compliance 35)', () => {
  it('moves no line and leaves the collected figure alone, because both legs are platform money', async () => {
    // The same page, built twice: `untouched` is what the page says before the
    // sweep, so the delta below is about the sweep and nothing else.
    holder.db = makeImpactDb(settledOnly());
    const untouched = await getBreakdown();
    expect(untouched.collected).toBe(100_000);

    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.providerSweep({ providerWithdrawalId: 'pw-1', amount: 40_000 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      ledgerEntries: ledger.rows,
    });

    const after = await getBreakdown();

    expect(after.collected).toBe(100_000);
    expect(diffOf(lines(untouched), lines(after))).toEqual(noLineMoved());
    // And the conservation law still holds, which is the real assertion: the
    // page would have thrown ImpactDoesNotReconcileError rather than answering
    // if the sweep had leaked into a line.
    expect(sumOf(lines(after))).toBe(100_000);
  });
});
