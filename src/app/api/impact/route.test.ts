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

  it('already counts a Refund that has only been REQUESTED as the Donor money, and keeps it out of the dispute-window line', async () => {
    // The freeze (refundRequestedLegs) credits FROZEN_BALANCE with the whole
    // Gross in the same transaction that takes it out of the pool, so from that
    // instant the money is the Donor's and never the Campaign's again. Calling
    // it "held in Escrow Hold" told a Donor their own refund was frozen inside
    // a dispute window they are not in -- money they are owed, counted as
    // money the platform is sitting on.
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

    expect(body.returnedToDonors).toBe(100_000);
    expect(body.heldInEscrowHold).toBe(0);
  });

  it('adds the two accounts of the returned line: money already handed back, and money committed to a Donor not yet paid', async () => {
    // Two Refunds, deliberately at opposite ends of their life: one approved
    // long ago and already paid, one requested seconds ago and untouched. The
    // line is a single number to a visitor, so it has to be the sum of both
    // accounts or one of the two Refunds simply disappears from the page.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 200_000, providerFee: 6_000, platformFee: 10_000 });
    // The Donation is settled and released, so the two Refunds below come out
    // of the withdrawable balance rather than out of Escrow Hold.
    ledger.release({ paymentId: 'payment-1', campaignId: 'campaign-1', amount: 184_000 });
    ledger.refundRequest({
      refundId: 'refund-settled',
      campaignId: 'campaign-1',
      amount: 60_000,
      source: 'CAMPAIGN_BALANCE',
      platformFeePortion: 3_000,
      providerFeePortion: 1_800,
    });
    ledger.refundApproval({ refundId: 'refund-settled', campaignId: 'campaign-1', amount: 60_000, source: 'CAMPAIGN_BALANCE', shortfall: 0 });
    ledger.refundPayment({ refundId: 'refund-settled', amount: 60_000 });
    ledger.refundRequest({
      refundId: 'refund-pending',
      campaignId: 'campaign-1',
      amount: 40_000,
      source: 'CAMPAIGN_BALANCE',
      platformFeePortion: 2_000,
      providerFeePortion: 1_200,
    });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [
        { id: 'refund-settled', paymentId: 'payment-1' },
        { id: 'refund-pending', paymentId: 'payment-1' },
      ],
      ledgerEntries: ledger.rows,
    });

    const body = lines(await getBreakdown());

    // 60 000 already back to the Donor (REFUND_CLEARING) + 40 000 frozen for a
    // Donor and not yet sent (FROZEN_BALANCE). Reading only the clearing
    // account would report 60 000 and lose the second Refund entirely.
    expect(body.returnedToDonors).toBe(100_000);
    // And the freeze is not money the platform is holding in escrow, so the
    // 40 000 shows up once, not twice.
    expect(body.heldInEscrowHold).toBe(0);
  });

  it('moves the page once per Refund, at the freeze, and not again after -- unless the Campaign could not cover it', async () => {
    // prd-compliance 28c. This walks the page through all four states of one
    // Refund's life and asserts what each step does to the six lines, because
    // the step 28c added is a MOVEMENT and an end-state assertion alone would
    // not notice it happening.
    //
    // THIS TRACE HAS NO SHORTFALL, AND THAT IS THE POINT OF SAYING SO IN THE
    // TITLE. The Campaign here can cover the Refund, so approval is a pure
    // handover and the page freezes from step 2 on. A Refund the Campaign CANNOT
    // cover moves the page again at approval -- the next test is that case, and
    // it is the one that makes "not again" a qualified claim rather than a
    // universal one.
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
    // And the movement happens ONCE, at the freeze, FOR A REFUND THE CAMPAIGN
    // COULD COVER. refundRequestedLegs takes the Campaign's net share out of the
    // pool and puts the WHOLE Gross into Frozen Balance, so from that instant
    // the money is the Donor's: the returned Platform Fee leaves
    // `platformFeeRetained` and the Provider Fee the provider will not return
    // leaves `providerFeeKept`, while `heldInEscrowHold` falls by the net share
    // the pool actually lost and `returnedToDonors` rises by the whole Gross.
    // Steps 3 and 4 -- approval and payment -- then move the same rupiah between
    // two accounts that are BOTH inside the returned line, so in THIS trace the
    // page does not move at all. A fee returned to the wrong account would
    // leave the same total -- every ledger transaction balances, so the
    // conservation law cannot tell -- and the wrong LINE. Which is why each step
    // below asserts the delta and not only the figures.
    //
    // "Does not move at all" IS TRUE OF THIS TRACE BECAUSE ITS SHORTFALL IS
    // ZERO, not because approval can never move the page. Approval credits
    // REFUND_CLEARING with the full Gross and debits the freeze, so while the
    // Campaign covered the Refund the two cancel inside the one line. When it
    // did NOT cover it, refundApprovedLegs also credits the source pool by the
    // shortfall, and the page moves by exactly that much -- the next test is
    // that case, and it is the one this trace does not reach.
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
    expect(sumOf(lines(settled))).toBe(100_000);
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
    //    will not return and the platform carries -- the 92 000 net share leaves
    //    Escrow Hold, and the whole 100 000 Gross becomes the returned line.
    //    The page still totals 100 000.
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
      returnedToDonors: 100_000,
      heldInEscrowHold: -92_000,
      platformFeeRetained: -5_000,
      providerFeeKept: -3_000,
    });
    expect(lines(frozen)).toEqual({
      disbursedToFundraisers: 0,
      returnedToDonors: 100_000,
      heldInEscrowHold: 0,
      availableInCampaignBalance: 0,
      platformFeeRetained: 0,
      providerFeeKept: 0,
    });
    // The Provider Fee is now the platform's expense, so it leaves the six
    // lines entirely and is reported beside them.
    expect(frozen.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 0 });

    // 3. A second Admin approves it, and -- because the Campaign covered this
    //    Refund -- the page must not move by a single rupiah. Approval is a
    //    handover between two accounts of the SAME line: Frozen Balance is
    //    debited as Refund Clearing is credited, and the Donor was owed this
    //    money before this Admin touched anything. With a shortfall it is NOT
    //    the same line, and the page does move; see the test after this one.
    ledger.refundApproval({ refundId: 'refund-1', campaignId: 'campaign-1', amount: 100_000, source: 'ESCROW_HOLD', shortfall: 0 });
    const approved = await getBreakdown();

    expect(approved.collected).toBe(100_000);
    expect(sumOf(lines(approved))).toBe(100_000);
    expect(diffOf(lines(frozen), lines(approved))).toEqual(noLineMoved());
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
    //    The page must not move by a single rupiah: the money has been reported
    //    as the Donor's since step 2, and the Donor is being handed what the
    //    page has been showing since before this Refund was approved.
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
    //    Read this test as "the page is a conservation law, and a Refund this
    //    Campaign could cover moves it exactly once", not as "the Provider
    //    Balance is drained correctly".
    ledger.refundPayment({ refundId: 'refund-1', amount: 100_000 });
    const paid = await getBreakdown();

    expect(paid.collected).toBe(100_000);
    expect(lines(paid)).toEqual(lines(approved));
    expect(diffOf(lines(approved), lines(paid))).toEqual(noLineMoved());
    expect(sumOf(lines(paid))).toBe(100_000);
    expect(paid.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 0 });
  });

  it('moves the page AGAIN at approval when the Campaign could not cover the Refund, by exactly the shortfall', async () => {
    // The test above walks a Refund the Campaign could cover, where approval is
    // a handover inside one line and the page does not move. THIS is the other
    // case, and it is why that test's title says "not again" rather than
    // "never": approval moves the page whenever the Campaign's own money did
    // not cover the Refund.
    //
    // WHY THE PAGE MUST MOVE, since a test asserting movement is a strange
    // thing to find on a transparency page. The freeze credits the WHOLE Gross
    // to the Donor, but it debits the Campaign's pool only by the net share
    // (Gross minus both fee portions) -- and here the pool is empty, so it is
    // debited below zero. The shortfall is money the CAMPAIGN NEVER HELD, and
    // at the freeze the page cannot know that yet: it is `impact.ts` that
    // subtracts `uncoveredRefunds` at the moment approval tops the pool back
    // up. So approval is a real movement of a real amount, from the returned
    // line back to the Campaign's balance, and the two cancel -- the six lines
    // total the same 100 000 before and after, which is exactly why an
    // end-state-only assertion would never have caught the movement at all.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    // Mature the escrow and pay the whole of it out, so the Campaign holds
    // nothing when the Donor asks for all 100 000 back.
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
    const db = () =>
      makeImpactDb({
        campaigns: [CAMPAIGN],
        payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
        refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
        payouts: [{ id: 'payout-1', campaignId: 'campaign-1', amount: 92_000, status: 'APPROVED' }],
        ledgerEntries: ledger.rows,
      });

    // At the freeze the page shows the whole 100 000 as the Donor's, and the
    // Campaign's balance reads NEGATIVE: the freeze debited a pool that had
    // already been paid out. Asserted because it is the state the shortfall is
    // invisible in -- nothing on the page says "uncovered" yet.
    holder.db = db();
    const frozen = await getBreakdown();

    expect(frozen.collected).toBe(100_000);
    expect(lines(frozen)).toEqual({
      disbursedToFundraisers: 92_000,
      returnedToDonors: 100_000,
      heldInEscrowHold: 0,
      availableInCampaignBalance: -92_000,
      platformFeeRetained: 0,
      providerFeeKept: 0,
    });
    expect(sumOf(lines(frozen))).toBe(100_000);
    expect(frozen.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 0 });

    // The second Admin approves, and the Campaign's pool cannot cover the net
    // share it was already debited, so `impact.ts` posts a 92 000 shortfall: a
    // credit to the Campaign's balance and a debit to Refund Cost. The page
    // reads the credit as `availableInCampaignBalance` and the Debit as
    // `uncoveredRefunds`, so the returned line gives back exactly 92 000 and
    // the platform reports absorbing it.
    ledger.refundApproval({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'CAMPAIGN_BALANCE',
      shortfall: 92_000,
    });
    holder.db = db();
    const approved = await getBreakdown();

    // THE DELTA, which is the whole point: the page DID move, and not by an
    // amount this test guessed from the end state -- the same 92_000 leaves
    // the returned line as the shortfall the ledger posted, so this assertion
    // fails if the reader stops subtracting `uncoveredRefunds` from the line.
    expect(diffOf(lines(frozen), lines(approved))).toEqual({
      ...noLineMoved(),
      returnedToDonors: -92_000,
      availableInCampaignBalance: 92_000,
    });
    expect(lines(approved).returnedToDonors).toBe(8_000);
    expect(lines(approved).availableInCampaignBalance).toBe(0);
    // The movement is a REOUTFIT, not a leak: the same 100 000 is collected and
    // the same 100 000 is in the six lines, and 92 000 of it is now named as
    // the platform's own cost instead of as a return of the Donors' money.
    expect(approved.collected).toBe(100_000);
    expect(sumOf(lines(approved))).toBe(100_000);
    expect(approved.platformCost).toEqual({ unrecoveredProviderFee: 3_000, uncoveredRefunds: 92_000 });
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
