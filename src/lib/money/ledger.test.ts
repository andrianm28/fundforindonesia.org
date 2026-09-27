import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  postTransaction,
  campaignBalance,
  escrowBalance,
  tripBalance,
  tripEscrowBalance,
  findUnbalancedTransactions,
  paymentSettledLegs,
  escrowReleaseLegs,
  refundRequestedLegs,
  refundApprovedLegs,
  payoutInstructedLegs,
  manualContributionReceivedLegs,
  manualContributionReversedLegs,
  programBalance,
  UnbalancedTransactionError,
  InvalidLedgerLegError,
  type LedgerLeg,
  type LedgerSubject,
  type ManualContributionSubject,
} from './ledger';

/**
 * A ledger is the one place where "mostly right" is worthless, so these tests
 * are about invariants rather than examples: every movement balances, nothing
 * single-sided gets in, and a retry cannot double-post.
 */

type Row = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
  programId: string | null;
};

/** Minimal in-memory stand-in for the Prisma transaction client. */
function makeTx(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  return {
    rows,
    ledgerEntry: {
      count: vi.fn(async ({ where }: { where: { transactionId: string } }) =>
        rows.filter((r) => r.transactionId === where.transactionId).length,
      ),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        rows.push(...data);
        return { count: data.length };
      }),
      groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
        const filtered = rows.filter((r) => {
          const w = args.where ?? {};
          return Object.entries(w).every(([k, v]) => (r as never as Record<string, unknown>)[k] === v);
        });
        const buckets = new Map<string, { row: Record<string, unknown>; sum: number }>();
        for (const r of filtered) {
          const key = args.by.map((k) => String((r as never as Record<string, unknown>)[k])).join('|');
          const b = buckets.get(key) ?? {
            row: Object.fromEntries(args.by.map((k) => [k, (r as never as Record<string, unknown>)[k]])),
            sum: 0,
          };
          b.sum += r.amount;
          buckets.set(key, b);
        }
        return Array.from(buckets.values()).map((b) => ({ ...b.row, _sum: { amount: b.sum } }));
      }),
    },
  };
}

const BALANCED: LedgerLeg[] = [
  { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000 },
  { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 100_000, campaignId: 'c1' },
];

describe('postTransaction', () => {
  let tx: ReturnType<typeof makeTx>;
  beforeEach(() => {
    tx = makeTx();
  });

  it('writes a balanced transaction', async () => {
    const id = await postTransaction(tx as never, BALANCED);
    expect(tx.rows).toHaveLength(2);
    expect(tx.rows.every((r) => r.transactionId === id)).toBe(true);
  });

  it('refuses an unbalanced transaction and writes nothing', async () => {
    const legs: LedgerLeg[] = [
      { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000 },
      { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 90_000, campaignId: 'c1' },
    ];
    await expect(postTransaction(tx as never, legs)).rejects.toThrow(UnbalancedTransactionError);
    expect(tx.rows).toHaveLength(0);
  });

  it('refuses a single-sided entry', async () => {
    // The classic way a ledger quietly stops balancing.
    await expect(
      postTransaction(tx as never, [BALANCED[0]] as LedgerLeg[]),
    ).rejects.toThrow(InvalidLedgerLegError);
  });

  it('refuses a negative or zero amount, because direction carries the sign', async () => {
    for (const amount of [0, -1]) {
      await expect(
        postTransaction(tx as never, [
          { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount },
          { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount, campaignId: 'c1' },
        ]),
      ).rejects.toThrow(InvalidLedgerLegError);
    }
  });

  it('refuses a non-integer amount', async () => {
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 10.5 },
        { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 10.5, campaignId: 'c1' },
      ]),
    ).rejects.toThrow(InvalidLedgerLegError);
  });

  it('requires a campaignId on campaign-scoped accounts', async () => {
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 1000 },
        { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 1000 },
      ]),
    ).rejects.toThrow(/requires a campaignId/);
  });

  it('requires a campaignId on ESCROW_HOLD too', async () => {
    // Held money belongs to one campaign. An unattached hold is money nobody
    // can claim and no release will ever find.
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 1000 },
        { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 1000 },
      ]),
    ).rejects.toThrow(/requires a campaignId/);
  });

  it('rejects a campaignId on a platform-level account', async () => {
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 1000, campaignId: 'c1' },
        { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 1000, campaignId: 'c1' },
      ]),
    ).rejects.toThrow(/platform-level/);
  });

  it('requires a volunteerTripId on trip-scoped accounts', async () => {
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 1000 },
        { account: 'TRIP_BALANCE', direction: 'CREDIT', amount: 1000 },
      ]),
    ).rejects.toThrow(/TRIP_BALANCE requires a volunteerTripId/);
  });

  it('requires a subject id of some kind on the accounts shared across subjects', async () => {
    // FROZEN_BALANCE is one subject's money whatever the subject is, so it
    // has no account of its own to be pinned to -- but it still has to belong
    // to somebody.
    await expect(
      postTransaction(tx as never, [
        { account: 'REFUND_CLEARING', direction: 'CREDIT', amount: 1000 },
        { account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: 1000 },
      ]),
    ).rejects.toThrow(/requires a campaignId or volunteerTripId or a programId/);
  });

  it('rejects a volunteerTripId on a platform-level account', async () => {
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 1000, volunteerTripId: 'trip-1' },
        { account: 'TRIP_BALANCE', direction: 'CREDIT', amount: 1000, volunteerTripId: 'trip-1' },
      ]),
    ).rejects.toThrow(/platform-level/);
  });

  it('rejects a CAMPAIGN_BALANCE leg carrying a volunteerTripId instead of a campaignId', async () => {
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 1000 },
        { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 1000, volunteerTripId: 'trip-1' },
      ]),
    ).rejects.toThrow(/CAMPAIGN_BALANCE requires a campaignId/);
  });

  it('rejects a TRIP_BALANCE leg carrying a campaignId instead of a volunteerTripId', async () => {
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 1000 },
        { account: 'TRIP_BALANCE', direction: 'CREDIT', amount: 1000, campaignId: 'c1' },
      ]),
    ).rejects.toThrow(/TRIP_BALANCE requires a volunteerTripId/);
  });

  it('rejects a leg carrying both campaignId and volunteerTripId', async () => {
    await expect(
      postTransaction(tx as never, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 1000 },
        {
          account: 'ESCROW_HOLD',
          direction: 'CREDIT',
          amount: 1000,
          campaignId: 'c1',
          volunteerTripId: 'trip-1',
        },
      ]),
    ).rejects.toThrow(/cannot carry both campaignId and volunteerTripId/);
  });

  it('is idempotent on transactionId, so a webhook retry posts once', async () => {
    await postTransaction(tx as never, BALANCED, { transactionId: 'evt-1' });
    await postTransaction(tx as never, BALANCED, { transactionId: 'evt-1' });
    expect(tx.rows).toHaveLength(2);
  });
});

describe('balances', () => {
  it('separates held money from withdrawable money, per campaign', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 100_000, providerFee: 3_000 }));
    await postTransaction(tx as never, paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c2' }, grossAmount: 50_000, providerFee: 0 }));

    // Settled, but inside the window: visible as escrow, withdrawable as zero.
    expect(await escrowBalance(tx as never, 'c1')).toBe(97_000);
    expect(await campaignBalance(tx as never, 'c1')).toBe(0);

    await postTransaction(tx as never, escrowReleaseLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 97_000 }));
    expect(await escrowBalance(tx as never, 'c1')).toBe(0);
    expect(await campaignBalance(tx as never, 'c1')).toBe(97_000);

    await postTransaction(tx as never, payoutInstructedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 40_000 }));
    expect(await campaignBalance(tx as never, 'c1')).toBe(57_000);

    // c2 is untouched throughout.
    expect(await escrowBalance(tx as never, 'c2')).toBe(50_000);
    expect(await campaignBalance(tx as never, 'c2')).toBe(0);
  });

  it('is zero for a campaign with no movements', async () => {
    expect(await campaignBalance(makeTx() as never, 'nobody')).toBe(0);
    expect(await escrowBalance(makeTx() as never, 'nobody')).toBe(0);
  });
});

describe('paymentSettledLegs', () => {
  it('credits the campaign the NET, not the gross', () => {
    const legs = paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 100_000, providerFee: 2_500 });
    // Crediting gross is how a campaign becomes able to withdraw money that
    // never arrived.
    expect(legs.find((l) => l.account === 'ESCROW_HOLD')?.amount).toBe(97_500);
    expect(legs.find((l) => l.account === 'PROVIDER_FEE')?.amount).toBe(2_500);
  });

  it('settles into escrow, never straight into the withdrawable balance', () => {
    // The whole point of the hold. If this ever regresses, money becomes
    // payable the instant it settles and the dispute window is gone.
    const legs = paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 100_000, providerFee: 0 });
    expect(legs.some((l) => l.account === 'CAMPAIGN_BALANCE')).toBe(false);
    expect(legs.some((l) => l.account === 'ESCROW_HOLD')).toBe(true);
  });

  it('omits the fee leg entirely when the fee is zero', () => {
    const legs = paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 100_000, providerFee: 0 });
    expect(legs.some((l) => l.account === 'PROVIDER_FEE')).toBe(false);
    expect(legs).toHaveLength(2);
  });

  it('rejects a fee larger than the payment, or negative', () => {
    expect(() => paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 1_000, providerFee: 1_001 })).toThrow();
    expect(() => paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 1_000, providerFee: -1 })).toThrow();
  });

  it('credits PLATFORM_FEE and reduces the net escrowed by both fees combined (prd-compliance 17)', () => {
    const legs = paymentSettledLegs({
      subject: { type: 'campaign', campaignId: 'c1' },
      grossAmount: 100_000,
      providerFee: 2_500,
      platformFee: 3_000,
    });
    expect(legs.find((l) => l.account === 'ESCROW_HOLD')?.amount).toBe(94_500);
    expect(legs.find((l) => l.account === 'PROVIDER_FEE')?.amount).toBe(2_500);
    expect(legs.find((l) => l.account === 'PLATFORM_FEE')?.amount).toBe(3_000);
  });

  it('omits the PLATFORM_FEE leg when platformFee is zero or omitted -- e.g. a Trip Fee settlement', () => {
    const withoutParam = paymentSettledLegs({ subject: { type: 'trip', tripId: 't1' }, grossAmount: 100_000, providerFee: 0 });
    expect(withoutParam.some((l) => l.account === 'PLATFORM_FEE')).toBe(false);

    const withZero = paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 100_000, providerFee: 0, platformFee: 0 });
    expect(withZero.some((l) => l.account === 'PLATFORM_FEE')).toBe(false);
  });

  it('rejects a platformFee that, combined with providerFee, exceeds the gross amount, or a negative platformFee', () => {
    expect(() =>
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 1_000, providerFee: 500, platformFee: 501 }),
    ).toThrow();
    expect(() =>
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 1_000, providerFee: 0, platformFee: -1 }),
    ).toThrow();
  });
});

describe('ledger invariants (property-based)', () => {
  it('every builder produces a transaction that balances, for any amount, for both subject types', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.constantFrom<'campaign' | 'trip'>('campaign', 'trip'),
        (gross, feeRaw, shortfallRaw, subjectType) => {
          const fee = Math.min(feeRaw, gross);
          const shortfall = Math.min(shortfallRaw, gross);
          const subject: LedgerSubject =
            subjectType === 'campaign'
              ? { type: 'campaign', campaignId: 'c1' }
              : { type: 'trip', tripId: 't1' };
          const balanceAccount = subjectType === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE';
          for (const legs of [
            paymentSettledLegs({ subject, grossAmount: gross, providerFee: fee }),
            escrowReleaseLegs({ subject, amount: gross }),
            refundRequestedLegs({ subject, amount: gross, source: 'ESCROW_HOLD', platformFeePortion: 0, providerFeePortion: fee }),
            refundRequestedLegs({ subject, amount: gross, source: balanceAccount, platformFeePortion: 0, providerFeePortion: fee }),
            refundApprovedLegs({ subject, amount: gross, source: balanceAccount, shortfall }),
            payoutInstructedLegs({ subject, amount: gross }),
          ]) {
            const d = legs.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amount, 0);
            const c = legs.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amount, 0);
            expect(d).toBe(c);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a long sequence of settlements, releases and payouts never leaves the ledger unbalanced', async () => {
    const tx = makeTx();
    for (let i = 0; i < 25; i++) {
      await postTransaction(
        tx as never,
        paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 10_000 + i, providerFee: i }),
      );
      await postTransaction(tx as never, escrowReleaseLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 10_000 }));
      if (i % 3 === 0) {
        await postTransaction(tx as never, payoutInstructedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 1_000 }));
      }
    }
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });

  it('the full lifecycle lands on the arithmetic everyone expects', async () => {
    const tx = makeTx();
    // Rp 500.000 donated, Rp 15.000 kept by the provider.
    await postTransaction(tx as never, paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 15_000 }));
    // Rp 100.000 refunded while still held (well within the 485.000 net credited) --
    // frozen first (splitting out its proportional 3_000 provider-fee share
    // right there), then settled with no shortfall.
    await postTransaction(
      tx as never,
      refundRequestedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 100_000, source: 'ESCROW_HOLD', platformFeePortion: 0, providerFeePortion: 3_000 }),
    );
    await postTransaction(
      tx as never,
      refundApprovedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 100_000, source: 'ESCROW_HOLD', shortfall: 0 }),
    );
    // The freeze already debited ESCROW_HOLD only its 97_000 NET share
    // (485_000 - 97_000 = 388_000), so that is what matures.
    await postTransaction(tx as never, escrowReleaseLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 388_000 }));
    // Rp 200.000 paid out.
    await postTransaction(tx as never, payoutInstructedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 200_000 }));

    expect(await escrowBalance(tx as never, 'c1')).toBe(0);
    expect(await campaignBalance(tx as never, 'c1')).toBe(188_000);
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });
});

describe('findUnbalancedTransactions already covers trip-scoped entries', () => {
  it('flags a trip-scoped transaction whose legs do not sum to zero', async () => {
    const tx = makeTx();
    // Deliberately bypass postTransaction's own balance guard, writing
    // directly the way a real bug (not this plan's own code) would have
    // to reach the database to produce this state.
    tx.rows.push(
      { transactionId: 'trip-tx-1', direction: 'DEBIT', amount: 10_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-9', programId: null },
      { transactionId: 'trip-tx-1', direction: 'CREDIT', amount: 9_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-9', programId: null },
    );

    const result = await findUnbalancedTransactions(tx as never);

    expect(result).toEqual([{ transactionId: 'trip-tx-1', debits: 10_000, credits: 9_000 }]);
  });
});

describe('paymentSettledLegs with a trip subject', () => {
  it('credits ESCROW_HOLD with volunteerTripId, not campaignId', () => {
    const legs = paymentSettledLegs({
      subject: { type: 'trip', tripId: 'trip-1' },
      grossAmount: 100_000,
      providerFee: 2_000,
    });
    expect(legs).toEqual([
      { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000 },
      { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 98_000, volunteerTripId: 'trip-1' },
      { account: 'PROVIDER_FEE', direction: 'CREDIT', amount: 2_000 },
    ]);
  });

  it('still credits ESCROW_HOLD with campaignId for a campaign subject, unchanged', () => {
    const legs = paymentSettledLegs({
      subject: { type: 'campaign', campaignId: 'camp-1' },
      grossAmount: 100_000,
      providerFee: 0,
    });
    expect(legs).toEqual([
      { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000 },
      { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 100_000, campaignId: 'camp-1' },
    ]);
  });
});

describe('escrowReleaseLegs with a trip subject', () => {
  it('credits TRIP_BALANCE, not CAMPAIGN_BALANCE', () => {
    const legs = escrowReleaseLegs({ subject: { type: 'trip', tripId: 'trip-1' }, amount: 50_000 });
    expect(legs).toEqual([
      { account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 50_000, volunteerTripId: 'trip-1' },
      { account: 'TRIP_BALANCE', direction: 'CREDIT', amount: 50_000, volunteerTripId: 'trip-1' },
    ]);
  });
});

describe('payoutInstructedLegs with a trip subject', () => {
  it('debits TRIP_BALANCE, not CAMPAIGN_BALANCE', () => {
    const legs = payoutInstructedLegs({ subject: { type: 'trip', tripId: 'trip-1' }, amount: 30_000 });
    expect(legs).toEqual([
      { account: 'TRIP_BALANCE', direction: 'DEBIT', amount: 30_000, volunteerTripId: 'trip-1' },
      { account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: 30_000 },
    ]);
  });
});

describe('tripBalance / tripEscrowBalance', () => {
  it('separates held money from withdrawable money, per trip, mirroring the campaign case above', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'trip', tripId: 't1' }, grossAmount: 100_000, providerFee: 3_000 }),
    );

    expect(await tripEscrowBalance(tx as never, 't1')).toBe(97_000);
    expect(await tripBalance(tx as never, 't1')).toBe(0);

    await postTransaction(
      tx as never,
      escrowReleaseLegs({ subject: { type: 'trip', tripId: 't1' }, amount: 97_000 }),
    );
    expect(await tripEscrowBalance(tx as never, 't1')).toBe(0);
    expect(await tripBalance(tx as never, 't1')).toBe(97_000);

    await postTransaction(
      tx as never,
      payoutInstructedLegs({ subject: { type: 'trip', tripId: 't1' }, amount: 40_000 }),
    );
    expect(await tripBalance(tx as never, 't1')).toBe(57_000);
  });

  it('is zero for a trip with no movements', async () => {
    expect(await tripBalance(makeTx() as never, 'nobody')).toBe(0);
    expect(await tripEscrowBalance(makeTx() as never, 'nobody')).toBe(0);
  });

  it('CROSS-SUBJECT LEAKAGE: does not sum a CAMPAIGN_BALANCE entry into tripBalance for the same raw id value', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'shared-id' }, grossAmount: 100_000, providerFee: 0 }),
    );
    await postTransaction(
      tx as never,
      escrowReleaseLegs({ subject: { type: 'campaign', campaignId: 'shared-id' }, amount: 100_000 }),
    );
    expect(await tripBalance(tx as never, 'shared-id')).toBe(0);
    expect(await campaignBalance(tx as never, 'shared-id')).toBe(100_000);
  });

  it('CROSS-SUBJECT LEAKAGE: does not sum a TRIP_BALANCE entry into campaignBalance for the same raw id value', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'trip', tripId: 'shared-id' }, grossAmount: 50_000, providerFee: 0 }),
    );
    await postTransaction(
      tx as never,
      escrowReleaseLegs({ subject: { type: 'trip', tripId: 'shared-id' }, amount: 50_000 }),
    );
    expect(await campaignBalance(tx as never, 'shared-id')).toBe(0);
    expect(await tripBalance(tx as never, 'shared-id')).toBe(50_000);
  });
});

/**
 * Manual Contribution (CONTEXT.md): money that arrived outside the payment
 * gateway, so there is no Settlement, no Escrow Hold and neither fee. It is
 * credited straight to the withdrawable balance, on its own ledger accounts,
 * and can be taken back out by the mirror-image journal.
 */
describe('manualContributionReceivedLegs / manualContributionReversedLegs', () => {
  const CAMPAIGN: ManualContributionSubject = { type: 'campaign', campaignId: 'camp-1' };
  const PROGRAM: ManualContributionSubject = { type: 'program', programId: 'prog-1' };

  it('credits the Campaign Balance directly -- no Escrow Hold, and neither fee', () => {
    const legs = manualContributionReceivedLegs({ subject: CAMPAIGN, amount: 75_000 });

    expect(legs).toEqual([
      { account: 'MANUAL_INTAKE_CLEARING', direction: 'DEBIT', amount: 75_000 },
      { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 75_000, campaignId: 'camp-1' },
    ]);
    // A hold would strand the money for seven days for a bank transfer that
    // already cleared; a fee would mean the campaign is credited less than
    // the rupiah that arrived.
    expect(legs.some((l) => l.account === 'ESCROW_HOLD')).toBe(false);
    expect(legs.some((l) => l.account === 'PLATFORM_FEE' || l.account === 'PROVIDER_FEE')).toBe(false);
  });

  it('credits PROGRAM_BALANCE when the contribution names a Program', () => {
    const legs = manualContributionReceivedLegs({ subject: PROGRAM, amount: 40_000 });

    expect(legs).toEqual([
      { account: 'MANUAL_INTAKE_CLEARING', direction: 'DEBIT', amount: 40_000 },
      { account: 'PROGRAM_BALANCE', direction: 'CREDIT', amount: 40_000, programId: 'prog-1' },
    ]);
  });

  it('never credits TRIP_BALANCE, because a Program is not a Volunteer Trip and a Campaign is not either', () => {
    for (const subject of [CAMPAIGN, PROGRAM]) {
      const legs = manualContributionReceivedLegs({ subject, amount: 1_000 });
      expect(legs.some((l) => l.account === 'TRIP_BALANCE')).toBe(false);
    }
  });

  it('reverses with the exact mirror image of the credit, on the same accounts', () => {
    // Compared as a set keyed by account, because what has to be true is that
    // every account the credit touched is debited here and vice versa -- the
    // order the two legs happen to be listed in is not the invariant.
    const byAccount = (legs: LedgerLeg[]) =>
      Object.fromEntries(
        legs.map((leg) => [leg.account, { ...leg, direction: leg.direction }]),
      );
    const received = byAccount(manualContributionReceivedLegs({ subject: PROGRAM, amount: 40_000 }));
    const reversed = byAccount(manualContributionReversedLegs({ subject: PROGRAM, amount: 40_000 }));

    expect(reversed).toEqual({
      MANUAL_INTAKE_CLEARING: { ...received.MANUAL_INTAKE_CLEARING, direction: 'CREDIT' },
      PROGRAM_BALANCE: { ...received.PROGRAM_BALANCE, direction: 'DEBIT' },
    });
  });

  it('is idempotent per Manual Contribution, so a retry cannot post the credit twice', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, manualContributionReceivedLegs({ subject: CAMPAIGN, amount: 10_000 }), {
      manualContributionId: 'mc-1',
      transactionId: 'manual-contribution-mc-1',
    });
    await postTransaction(tx as never, manualContributionReceivedLegs({ subject: CAMPAIGN, amount: 10_000 }), {
      manualContributionId: 'mc-1',
      transactionId: 'manual-contribution-mc-1',
    });

    expect(tx.rows).toHaveLength(2);
    expect(await campaignBalance(tx as never, 'camp-1')).toBe(10_000);
  });

  it('leaves the Campaign Balance where the reversal found it, never below zero', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, manualContributionReceivedLegs({ subject: CAMPAIGN, amount: 60_000 }));
    expect(await campaignBalance(tx as never, 'camp-1')).toBe(60_000);

    await postTransaction(tx as never, manualContributionReversedLegs({ subject: CAMPAIGN, amount: 60_000 }));

    expect(await campaignBalance(tx as never, 'camp-1')).toBe(0);
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });

  it('keeps each Program balance to its own Program', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, manualContributionReceivedLegs({ subject: PROGRAM, amount: 40_000 }));
    await postTransaction(
      tx as never,
      manualContributionReceivedLegs({ subject: { type: 'program', programId: 'prog-2' }, amount: 15_000 }),
    );

    expect(await programBalance(tx as never, 'prog-1')).toBe(40_000);
    expect(await programBalance(tx as never, 'prog-2')).toBe(15_000);
  });

  it('CROSS-SUBJECT LEAKAGE: a Program and a Campaign sharing a raw id value never see each other money', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      manualContributionReceivedLegs({ subject: { type: 'program', programId: 'shared-id' }, amount: 40_000 }),
    );

    expect(await campaignBalance(tx as never, 'shared-id')).toBe(0);
    expect(await programBalance(tx as never, 'shared-id')).toBe(40_000);
  });

  it('CROSS-SUBJECT LEAKAGE: a Campaign balance never counts PROGRAM_BALANCE and the reverse', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      manualContributionReceivedLegs({ subject: { type: 'program', programId: 'camp-1' }, amount: 40_000 }),
    );

    expect(await campaignBalance(tx as never, 'camp-1')).toBe(0);
    expect(await programBalance(tx as never, 'camp-1')).toBe(40_000);
  });

  it('refuses a PROGRAM_BALANCE leg with no programId, so the money belongs to nobody', async () => {
    await expect(
      postTransaction(makeTx() as never, [
        { account: 'MANUAL_INTAKE_CLEARING', direction: 'DEBIT', amount: 1000 },
        { account: 'PROGRAM_BALANCE', direction: 'CREDIT', amount: 1000 },
      ]),
    ).rejects.toThrow(/PROGRAM_BALANCE requires a programId/);
  });

  it('refuses a programId on a platform-level account, the intake clearing included', async () => {
    // The intake side is the platform's own money; scoping it to a Program
    // would let a Program's figure be read off a platform-wide account.
    await expect(
      postTransaction(makeTx() as never, [
        { account: 'MANUAL_INTAKE_CLEARING', direction: 'DEBIT', amount: 1000, programId: 'prog-1' },
        { account: 'PROGRAM_BALANCE', direction: 'CREDIT', amount: 1000, programId: 'prog-1' },
      ]),
    ).rejects.toThrow(/platform-level/);
  });

  it('refuses a leg carrying a programId alongside a campaignId or a volunteerTripId', async () => {
    await expect(
      postTransaction(makeTx() as never, [
        { account: 'MANUAL_INTAKE_CLEARING', direction: 'DEBIT', amount: 1000 },
        { account: 'PROGRAM_BALANCE', direction: 'CREDIT', amount: 1000, programId: 'p1', campaignId: 'c1' },
      ]),
    ).rejects.toThrow(/cannot carry a programId/);
  });

  it('is zero for a Program with no movements', async () => {
    expect(await programBalance(makeTx() as never, 'nobody')).toBe(0);
  });
});

describe('ledger invariants with a Manual Contribution (property-based)', () => {
  it('a manual contribution and its reversal balance for any amount, for either target', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.constantFrom<'campaign' | 'program'>('campaign', 'program'),
        (amount, subjectType) => {
          const subject: ManualContributionSubject =
            subjectType === 'campaign'
              ? { type: 'campaign', campaignId: 'c1' }
              : { type: 'program', programId: 'p1' };
          for (const legs of [
            manualContributionReceivedLegs({ subject, amount }),
            manualContributionReversedLegs({ subject, amount }),
          ]) {
            const debits = legs.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amount, 0);
            const credits = legs.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amount, 0);
            expect(debits).toBe(credits);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
