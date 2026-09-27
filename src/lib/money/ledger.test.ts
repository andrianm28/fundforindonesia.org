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
  refundPaidLegs,
  payoutInstructedLegs,
  manualContributionReceivedLegs,
  manualContributionReversedLegs,
  programBalance,
  payoutCompletedLegs,
  collectionAccountWithdrawalLegs,
  collectionAccountBalance,
  providerBalances,
  UnbalancedTransactionError,
  InvalidLedgerLegError,
  DuplicateLedgerTransactionError,
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
  /** Position of this leg inside its transaction. 0 is the claiming leg. */
  legIndex: number;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
  programId: string | null;
  /** Which provider this movement went through. Null where nobody recorded one. */
  provider: string | null;
};

/** The one unique index a ledger posting can reach; see makeTx below. */
const CLAIM_INDEX = 'LedgerEntry_transactionId_claim_key';

/**
 * The unique violation Postgres raises, shaped the way Prisma reports it.
 *
 * Recorded from a real run against Postgres (Prisma 7 over the pg driver
 * adapter): `code` P2002, and the index named under the driver adapter's own
 * nesting -- there is no `meta.target` or `meta.field_name` in this shape. The
 * fake below is that object, so the unit tests here meet the same error the
 * database produces rather than one invented to suit them; the real one is
 * checked against a real database in
 * src/__tests__/ledger-transaction-claim-migration.test.ts.
 */
function uniqueViolation(): Error {
  return Object.assign(
    new Error('Unique constraint failed on the constraint: `LedgerEntry_transactionId_claim_key`'),
    {
      code: 'P2002',
      meta: {
        modelName: 'LedgerEntry',
        driverAdapterError: {
          cause: {
            originalCode: '23505',
            kind: 'UniqueConstraintViolation',
            constraint: { index: CLAIM_INDEX },
            table: 'LedgerEntry',
          },
        },
      },
    },
  );
}

/**
 * Minimal in-memory stand-in for the Prisma transaction client.
 *
 * `createMany` models the one thing the database does that no application code
 * can: the partial unique index `LedgerEntry_transactionId_claim_key` (WHERE
 * "legIndex" = 0), which makes a transactionId claimable by exactly one row
 * ever. The whole statement fails when the claim is already taken, which is
 * what Postgres does -- a multi-row INSERT either lands whole or not at all.
 */
function makeTx(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  return {
    rows,
    ledgerEntry: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        for (const row of data) {
          if (row.legIndex !== 0) continue;
          if (rows.some((r) => r.legIndex === 0 && r.transactionId === row.transactionId)) {
            throw uniqueViolation();
          }
        }
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

/** Credits minus debits on one account -- the credit-normal balance, the way
 *  ledger.ts's own accountBalance reads one. */
function netOf(rows: Row[], account: string): number {
  return rows
    .filter((r) => r.account === account)
    .reduce((total, r) => total + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);
}

/** Debits minus credits -- for the accounts that grow when they are debited:
 *  the Provider Balance (money in the pot) and an expense like REFUND_COST
 *  (money the platform has spent). Reading these with netOf would report a
 *  pot of money as a negative pot, which is how a real one looks. */
function heldOf(rows: Row[], account: string): number {
  return -netOf(rows, account);
}

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

  it('claims the transactionId with its first leg, so the database has one row to refuse the next attempt on', async () => {
    await postTransaction(tx as never, BALANCED, { transactionId: 'evt-1' });
    // legIndex 0 is the claim the unique index is built on. A test asserting
    // anything else about these rows is asserting the wrong thing.
    expect(tx.rows.map((r) => [r.legIndex, r.direction])).toEqual([
      [0, 'DEBIT'],
      [1, 'CREDIT'],
    ]);
  });

  it('refuses to post a transactionId twice, and says which one, as a duplicate', async () => {
    await postTransaction(tx as never, BALANCED, { transactionId: 'evt-1' });

    // A webhook retry, a replayed admin action, anything that reaches here
    // twice. The refusal names the duplicate so a caller can tell it apart
    // from a genuine write failure -- and the first posting is untouched:
    // refusing the retry must never mean posting it twice.
    await expect(postTransaction(tx as never, BALANCED, { transactionId: 'evt-1' })).rejects.toThrow(
      DuplicateLedgerTransactionError,
    );
    await expect(postTransaction(tx as never, BALANCED, { transactionId: 'evt-1' })).rejects.toMatchObject({
      transactionId: 'evt-1',
    });
    expect(tx.rows).toHaveLength(2);
  });

  it('leaves exactly one transaction behind when the same id is posted twice at once', async () => {
    // Two callers racing, neither of them having claimed a row first -- the
    // case the read-then-write this replaced could not see. A real database
    // makes the second INSERT wait for the first to commit before refusing it;
    // a fake cannot interleave statements, so what this pins is the refusal
    // and that the loser writes nothing at all, not the blocking itself.
    const [first, second] = await Promise.allSettled([
      postTransaction(tx as never, BALANCED, { transactionId: 'race-1' }),
      postTransaction(tx as never, BALANCED, { transactionId: 'race-1' }),
    ]);

    const outcomes = [first, second];
    const winner = outcomes.find((o) => o.status === 'fulfilled');
    const loser = outcomes.find((o) => o.status === 'rejected');
    expect(winner?.status === 'fulfilled' ? winner.value : null).toBe('race-1');
    expect(loser?.status === 'rejected' ? loser.reason : null).toBeInstanceOf(
      DuplicateLedgerTransactionError,
    );
    expect(tx.rows).toHaveLength(2);
    expect(tx.rows.every((r) => r.transactionId === 'race-1')).toBe(true);
    // One balanced transaction, not two halves of one: the loser's statement
    // wrote nothing at all.
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
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

describe('payoutCompletedLegs', () => {
  it('drains PAYOUT_CLEARING and credits the Provider Balance, carrying no subject of its own', () => {
    // Both legs are platform-level: the money is at the provider, so which
    // Campaign it came from is not what the movement is about. A subject FK
    // here would be rejected by assertLegsValid (ledger.ts) and would make
    // the Provider Balance unreadable per campaign, which is not a question
    // anyone asks.
    expect(payoutCompletedLegs({ amount: 200_000 })).toEqual([
      { account: 'PAYOUT_CLEARING', direction: 'DEBIT', amount: 200_000 },
      { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 200_000 },
    ]);
  });

  it('closes the Provider Balance gap: what settlement debits, a completed payout credits back', async () => {
    // Before completion existed, GATEWAY_CLEARING was DEBITED on every
    // settlement and credited by nothing, so the account grew by the full
    // gross of every Donation forever and the books claimed a larger pot at
    // the provider than could ever exist. ADR 0011 wanted to state the
    // invariant "Provider Balance = GATEWAY_CLEARING less what an Admin has
    // withdrawn"; the withdrawal leg is what makes it statable.
    const tx = makeTx();
    await postTransaction(tx as never, paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 15_000 }));
    await postTransaction(tx as never, escrowReleaseLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 485_000 }));
    await postTransaction(tx as never, payoutInstructedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 200_000 }));

    // Instructed but not yet transferred: the money is in flight, so it is
    // still at the provider.
    expect(netOf(tx.rows, 'GATEWAY_CLEARING')).toBe(-500_000);
    expect(netOf(tx.rows, 'PAYOUT_CLEARING')).toBe(200_000);

    await postTransaction(tx as never, payoutCompletedLegs({ amount: 200_000 }));

    // Transferred: PAYOUT_CLEARING is empty again and the Provider Balance
    // is exactly the gross settled less what has left it.
    expect(netOf(tx.rows, 'PAYOUT_CLEARING')).toBe(0);
    expect(netOf(tx.rows, 'GATEWAY_CLEARING')).toBe(-300_000);
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });

  it('refuses an amount of zero -- a zero-amount leg is rejected by postTransaction, and a zero transfer is not a transfer', async () => {
    await expect(postTransaction(makeTx() as never, payoutCompletedLegs({ amount: 0 }))).rejects.toThrow(InvalidLedgerLegError);
  });
});

describe('collectionAccountWithdrawalLegs', () => {
  it('moves money from the Provider Balance to the Collection Account, which are two different things', () => {
    // ADR 0011: the Merchant Account is PT Jaya Korpora Prima's and the
    // collection account is a DIFFERENT account that may belong to a different
    // legal entity. So the sweep is a real movement between two accounts, not a
    // memo, and the two must not be the same row of the chart of accounts --
    // collapsing them is what makes "the money reached the bank" invisible.
    expect(collectionAccountWithdrawalLegs({ amount: 750_000 })).toEqual([
      { account: 'COLLECTION_ACCOUNT', direction: 'DEBIT', amount: 750_000 },
      { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 750_000 },
    ]);
  });

  it('carries no subject: the collection account is a bank account, not a Campaign balance', () => {
    expect(collectionAccountWithdrawalLegs({ amount: 1_000 }).every((l) => l.campaignId === undefined && l.volunteerTripId === undefined)).toBe(true);
  });

  it('leaves the money visible in exactly one place per side: out of the provider, in the bank', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 15_000 }),
      { provider: 'sumopod' },
    );

    // Settled, never swept: the whole Gross is at the provider, and the
    // Collection Account is empty -- an account nothing has ever credited
    // reads as zero, not as "money that arrived".
    //
    // Read with heldOf, not netOf: the sweep DEBITS the Collection Account, so
    // it is debit-normal the way the Provider Balance is, and money sitting in
    // a bank is a positive number.
    expect(heldOf(tx.rows, 'GATEWAY_CLEARING')).toBe(500_000);
    expect(tx.rows.filter((r) => r.account === 'COLLECTION_ACCOUNT')).toHaveLength(0);

    await postTransaction(tx as never, collectionAccountWithdrawalLegs({ amount: 750_000 }), { provider: 'sumopod' });

    expect(heldOf(tx.rows, 'GATEWAY_CLEARING')).toBe(-250_000);
    expect(heldOf(tx.rows, 'COLLECTION_ACCOUNT')).toBe(750_000);
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });

  it('refuses a zero sweep: a zero-amount leg is rejected, and transferring nothing is not a transfer', async () => {
    await expect(postTransaction(makeTx() as never, collectionAccountWithdrawalLegs({ amount: 0 }))).rejects.toThrow(InvalidLedgerLegError);
  });
});

describe('collectionAccountBalance', () => {
  it('reads a sweep as a positive number, because the sweep DEBITS this account', async () => {
    // The direction, pinned to what the code does rather than to what the
    // account sounds like it should be. A sweep of 750_000 that read as
    // -750_000 would put money that reached a bank on the wrong side of the
    // world, and a reader that returns credits-minus-debits would print 0 on a
    // system that had just moved a million rupiah out of the Provider Balance.
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 1_000_000, providerFee: 0 }),
      { provider: 'sumopod' },
    );
    expect(await collectionAccountBalance(tx as never)).toBe(0);

    await postTransaction(tx as never, collectionAccountWithdrawalLegs({ amount: 750_000 }), { provider: 'sumopod' });

    expect(await collectionAccountBalance(tx as never)).toBe(750_000);
  });

  it('is zero before any money has been swept, because settling is not sweeping', async () => {
    // Settling is not sweeping. The Collection Account must not report money
    // sitting at the provider as money that reached a bank.
    //
    // The title used to promise the figure is "never negative" and the test
    // never asserted that, so it said less than it appeared to. It is left out
    // rather than added, because it is not a property of this reader: the only
    // builder that names this account debits it (see the last test in this
    // describe), so a reading below zero is a state no movement in this
    // codebase can produce, and an assertion about it would guard nothing. The
    // sign that IS a decision -- a sweep reading as a positive number -- is
    // pinned by the test above, and the credit side of the same subtraction by
    // the one below.
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 5_000_000, providerFee: 0 }),
      { provider: 'sumopod' },
    );

    expect(await collectionAccountBalance(tx as never)).toBe(0);
  });

  it('nets a debit against a credit on the same account, rather than adding them, on a state no builder produces today', async () => {
    // Every other balance here is credits-minus-debits, so this is the one
    // reader whose sign has to be argued for. It is not a preference: the sweep
    // DEBITS the account, the same way a settlement DEBITS the Provider Balance,
    // so it is read debits-minus-credits like that account is.
    //
    // The credit is seeded rather than posted, and the title says so, because a
    // movement that credits this account does not exist: the only builder that
    // names it debits it, which the test below pins. What is under test is the
    // reader's arithmetic on both sides of the subtraction -- the CREDIT branch
    // of accountTotal, which no other test of this reader reaches -- and not a
    // movement the chart of accounts does not have. If a builder ever does
    // credit this account, that test fails and this one becomes a statement
    // about behaviour instead of about arithmetic.
    const tx = makeTx([
      { transactionId: 'sweep-1', legIndex: 0, direction: 'DEBIT', amount: 750_000, account: 'COLLECTION_ACCOUNT', campaignId: null, volunteerTripId: null, programId: null, provider: 'sumopod' },
      { transactionId: 'other-1', legIndex: 0, direction: 'CREDIT', amount: 250_000, account: 'COLLECTION_ACCOUNT', campaignId: null, volunteerTripId: null, programId: null, provider: 'sumopod' },
    ]);

    expect(await collectionAccountBalance(tx as never)).toBe(500_000);
  });

  it('has no movement that can credit the Collection Account, which is what makes the test above a seeded state', async () => {
    // The premise of the seeded-CREDIT test, asserted rather than left in a
    // comment. A leg builder naming this account is the only way a row can
    // reach it, and every one of them debits it, so "no builder produces a
    // credit here" is checkable -- and when a movement that credits the account
    // is ever added (a corrected sweep, a clawback), this fails and the seeded
    // test's title has to be re-read rather than quietly left standing.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'money', 'ledger.ts'), 'utf8');

    const directions = [
      ...source.matchAll(/account: 'COLLECTION_ACCOUNT',\s*direction: '(\w+)'/g),
    ].map((match) => match[1]);

    // Greater than zero, so a leg written in some other shape cannot make this
    // pass by finding nothing to complain about.
    expect(directions.length).toBeGreaterThan(0);
    expect([...new Set(directions)]).toEqual(['DEBIT']);
  });
});

describe('providerBalances', () => {
  it('reads the Provider Balance per provider, and shows the unnamed remainder as its own bucket', async () => {
    // The shape the reconciliation needs. A completed Payout credits the
    // Provider Balance WITHOUT naming a provider -- nothing records that today
    // -- and folding those credits into whichever provider happens to be first
    // would hand one provider's report a number that belongs to another. So the
    // null bucket is returned, not resolved: it is the honest answer to "whose
    // pot is this?", and it is what tells a reader the per-provider figures are
    // a floor rather than the whole money.
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 0 }),
      { provider: 'sumopod' },
    );
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c2' }, grossAmount: 200_000, providerFee: 0 }),
      { provider: 'xendit' },
    );
    await postTransaction(tx as never, payoutCompletedLegs({ amount: 120_000 }));

    expect(await providerBalances(tx as never)).toEqual([
      { provider: 'sumopod', debited: 500_000, credited: 0, balance: 500_000 },
      { provider: 'xendit', debited: 200_000, credited: 0, balance: 200_000 },
      { provider: null, debited: 0, credited: 120_000, balance: -120_000 },
    ]);
  });

  it('keeps a withdrawal against the provider it was drawn from, so the pot shrinks for that provider only', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 0 }),
      { provider: 'sumopod' },
    );
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c2' }, grossAmount: 900_000, providerFee: 0 }),
      { provider: 'xendit' },
    );
    await postTransaction(tx as never, collectionAccountWithdrawalLegs({ amount: 300_000 }), { provider: 'sumopod' });

    const pots = await providerBalances(tx as never);
    expect(pots.find((p) => p.provider === 'sumopod')).toEqual({
      provider: 'sumopod',
      debited: 500_000,
      credited: 300_000,
      balance: 200_000,
    });
    // The other provider's money is untouched by a sweep out of this one, which
    // is the whole reason the column exists.
    expect(pots.find((p) => p.provider === 'xendit')?.balance).toBe(900_000);
  });

  it('is debit-normal, like heldOf: a pot of money at a provider is a positive number', async () => {
    // Read the wrong way round this reports a pot of 500_000 as -500_000, and
    // a report that prints that looks like the platform is 500_000 overdrawn at
    // the provider. The direction is not a detail of the reader.
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 0 }),
      { provider: 'sumopod' },
    );
    expect((await providerBalances(tx as never))[0].balance).toBe(500_000);
  });

  it('ignores accounts that are not the Provider Balance', async () => {
    // A campaign's own ESCROW_HOLD is money that reached the provider and is
    // still earmarked; it is not the platform's pot at the provider, and
    // counting it here would report a pot larger than the money actually
    // unencumbered. Only GATEWAY_CLEARING is the Provider Balance.
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 15_000 }),
      { provider: 'sumopod' },
    );
    expect(await providerBalances(tx as never)).toEqual([
      { provider: 'sumopod', debited: 500_000, credited: 0, balance: 500_000 },
    ]);
  });

  it('is empty when the provider has never been touched, rather than reporting a zero pot as a finding', async () => {
    expect(await providerBalances(makeTx() as never)).toEqual([]);
  });
});

describe('a Refund and the fee money it returns (prd-compliance 28c)', () => {
  it('takes the returned fees out to accounts named for what they are, and touches nothing unnamed', () => {
    // Gross 100_000 refunded in full, Platform Fee 2_500, Provider Fee 5_000.
    // The Donor gets their whole Gross back, so every rupiah of those fees
    // leaves the Campaign's pool too -- and the ledger has to say where each
    // one went rather than let it quietly reappear as somebody's balance.
    const legs = refundRequestedLegs({
      subject: { type: 'campaign', campaignId: 'c1' },
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 2_500,
      providerFeePortion: 5_000,
    });

    expect(legs).toEqual([
      { account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 100_000, campaignId: 'c1' },
      { account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 92_500, campaignId: 'c1' },
      // The platform's own retained revenue, handed back: not a loss, a return.
      { account: 'PLATFORM_FEE', direction: 'DEBIT', amount: 2_500 },
      // The Provider Fee the provider does not return, so the platform carries
      // it (ADR 0007). The account is named for the absorption, so the 7_500
      // the Campaign gave up and the Donor did not get back is accounted for.
      { account: 'REFUND_COST', direction: 'DEBIT', amount: 5_000 },
    ]);
  });

  it('does NOT credit GATEWAY_CLEARING at approval -- approving a Refund is not paying it', () => {
    // CONTEXT.md, Refund: created by one Admin, approved by another, and
    // completed by a third. Approval moves no money, so the Provider Balance
    // still holds the Gross the Donor is owed. Crediting it here would claim
    // the money had left the payment provider before anyone sent it, and
    // with no completion step in this codebase yet (ticket 32) nothing would
    // ever correct that claim.
    const legs = refundApprovedLegs({
      subject: { type: 'campaign', campaignId: 'c1' },
      amount: 100_000,
      source: 'ESCROW_HOLD',
      shortfall: 0,
    });

    expect(legs.some((l) => l.account === 'GATEWAY_CLEARING')).toBe(false);
    // The whole Gross is the Donor's claim by this point, in the account
    // named for the money owed to a Donor.
    expect(legs.find((l) => l.account === 'REFUND_CLEARING')).toEqual({
      account: 'REFUND_CLEARING',
      direction: 'CREDIT',
      amount: 100_000,
    });
  });

  it('refundPaidLegs takes the paid Gross out of the Provider Balance', () => {
    // The withdrawal path the returned fees ride out on. The Donor is paid
    // from the Provider Balance, so this is the credit GATEWAY_CLEARING has
    // never had on the Refund side -- the exact twin of a Payout's completion
    // leg, and the reason that account is no longer a pot that only ever
    // grows.
    expect(refundPaidLegs({ amount: 100_000 })).toEqual([
      { account: 'REFUND_CLEARING', direction: 'DEBIT', amount: 100_000 },
      { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 100_000 },
    ]);
  });

  it('refundPaidLegs carries no subject: the Provider Balance is platform-level, and a Trip Fee refund drains it the same way', () => {
    expect(refundPaidLegs({ amount: 40_000 }).every((l) => l.campaignId === undefined && l.volunteerTripId === undefined)).toBe(true);
  });

  it('lands the whole story on the arithmetic everyone expects, without the Campaign losing a rupiah extra', async () => {
    const tx = makeTx();
    // Rp 500.000 donated, Provider Fee 15.000 kept by the provider, Platform
    // Fee 12.500 kept by the platform, so the Campaign is credited 472.500.
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 15_000, platformFee: 12_500 }),
    );
    // The same 100.000 refund the lifecycle test below uses: its share of the
    // two fees is 3.000 and 2.500, so the pool gives up 94.500.
    await postTransaction(
      tx as never,
      refundRequestedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 100_000, source: 'ESCROW_HOLD', platformFeePortion: 2_500, providerFeePortion: 3_000 }),
    );
    await postTransaction(
      tx as never,
      refundApprovedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 100_000, source: 'ESCROW_HOLD', shortfall: 0 }),
    );

    // Approved but not yet paid: the 100.000 the Donor is owed is still at
    // the provider, so the Provider Balance still counts it.
    expect(heldOf(tx.rows, 'GATEWAY_CLEARING')).toBe(500_000);
    expect(netOf(tx.rows, 'REFUND_CLEARING')).toBe(100_000);

    // The platform has already given the Campaign's fee money back, and
    // booked the Provider Fee it will never recover: both on named accounts,
    // so the 5.500 the Donor did not get back is accounted for, not absorbed.
    expect(netOf(tx.rows, 'PLATFORM_FEE')).toBe(10_000); // 12.500 charged, 2.500 returned
    expect(heldOf(tx.rows, 'REFUND_COST')).toBe(3_000); // absorbed by the platform
    expect(netOf(tx.rows, 'PROVIDER_FEE')).toBe(15_000); // the provider still holds all of it

    // The Campaign's own credit is exactly what the settlement gave it --
    // a Refund costs it its net share of this payment and not one rupiah more.
    expect(tx.rows.filter((r) => r.account === 'ESCROW_HOLD' && r.direction === 'CREDIT')).toEqual([
      expect.objectContaining({ amount: 472_500 }),
    ]);
    expect(await escrowBalance(tx as never, 'c1')).toBe(378_000); // 472.500 - 94.500

    // Paid. The Provider Balance gives the 100.000 back, and the Donor is
    // owed nothing further.
    await postTransaction(tx as never, refundPaidLegs({ amount: 100_000 }));

    expect(heldOf(tx.rows, 'GATEWAY_CLEARING')).toBe(400_000);
    expect(netOf(tx.rows, 'REFUND_CLEARING')).toBe(0);

    // The Provider Balance still reconciles, and this is the statement that
    // says so: what sits in the pot, plus the 3.000 the platform has already
    // put into the provider's fee out of its own pocket, is exactly what that
    // pot is owed -- 378.000 still in the Campaign's escrow, 10.000 of
    // Platform Fee the platform kept, 15.000 the provider kept. No part of it
    // is a balance nobody is owed and nobody is holding.
    const owedToThePot = [
      netOf(tx.rows, 'ESCROW_HOLD'),
      netOf(tx.rows, 'PLATFORM_FEE'),
      netOf(tx.rows, 'PROVIDER_FEE'),
    ].reduce((total, amount) => total + amount, 0);
    expect(heldOf(tx.rows, 'GATEWAY_CLEARING') + heldOf(tx.rows, 'REFUND_COST')).toBe(owedToThePot);
    expect(owedToThePot).toBe(403_000);
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });

  it('books a shortfall on REFUND_COST, so the platform money covering it is named too', async () => {
    // The pool was already paid out, so most of the 100.000 refund finds
    // nothing to come from: the 92.500 net went out with the Payout, and the
    // freeze then debited the pool that same 92.500. That shortfall is the
    // platform's own money, and the account that says so is REFUND_COST --
    // not a hole the Provider Balance absorbs.
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 100_000, providerFee: 5_000, platformFee: 2_500 }),
    );
    await postTransaction(tx as never, escrowReleaseLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 92_500 }));
    await postTransaction(tx as never, payoutInstructedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 92_500 }));
    await postTransaction(
      tx as never,
      refundRequestedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 100_000, source: 'CAMPAIGN_BALANCE', platformFeePortion: 2_500, providerFeePortion: 5_000 }),
    );
    await postTransaction(
      tx as never,
      refundApprovedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 100_000, source: 'CAMPAIGN_BALANCE', shortfall: 92_500 }),
    );

    // 5.000 the provider will not return, plus the 92.500 the Campaign could
    // not cover: the whole 97.500 of platform money, on the one account named
    // for it, and the Campaign's balance is put back to zero rather than left
    // negative. The Provider Balance is untouched by any of it -- approval
    // moves no money out of the pot.
    expect(heldOf(tx.rows, 'REFUND_COST')).toBe(97_500);
    expect(await campaignBalance(tx as never, 'c1')).toBe(0);
    expect(heldOf(tx.rows, 'GATEWAY_CLEARING')).toBe(100_000);
    expect(netOf(tx.rows, 'PLATFORM_FEE')).toBe(0); // 2.500 charged, 2.500 returned
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
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
            refundPaidLegs({ amount: gross }),
            payoutInstructedLegs({ subject, amount: gross }),
            payoutCompletedLegs({ amount: gross }),
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
        await postTransaction(tx as never, payoutCompletedLegs({ amount: 1_000 }));
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
    // ...and transferred. Completion moves money out of the platform's own
    // books (PAYOUT_CLEARING -> the Provider Balance), so it cannot change
    // what the Campaign may withdraw -- that was already spent at the
    // instruction.
    await postTransaction(tx as never, payoutCompletedLegs({ amount: 200_000 }));

    expect(await escrowBalance(tx as never, 'c1')).toBe(0);
    expect(await campaignBalance(tx as never, 'c1')).toBe(188_000);
    expect(netOf(tx.rows, 'PAYOUT_CLEARING')).toBe(0);
    expect(netOf(tx.rows, 'GATEWAY_CLEARING')).toBe(-300_000);
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
      { transactionId: 'trip-tx-1', legIndex: 0, direction: 'DEBIT', amount: 10_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-9', programId: null, provider: null },
      { transactionId: 'trip-tx-1', legIndex: 1, direction: 'CREDIT', amount: 9_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-9', programId: null, provider: null },
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
    // The retry is refused by the database rather than silently ignored: the
    // transactionId is claimed by one entry, and a second claim of the same id
    // is a unique violation (prd-28b). The invariant this test is about is
    // unchanged -- the credit is posted once and once only -- but it is now the
    // partial unique index that enforces it, not postTransaction quietly
    // writing nothing. The first posting is untouched by the refusal.
    const tx = makeTx();
    const legs = manualContributionReceivedLegs({ subject: CAMPAIGN, amount: 10_000 });
    await postTransaction(tx as never, legs, {
      manualContributionId: 'mc-1',
      transactionId: 'manual-contribution-mc-1',
    });
    await expect(
      postTransaction(tx as never, legs, {
        manualContributionId: 'mc-1',
        transactionId: 'manual-contribution-mc-1',
      }),
    ).rejects.toThrow(DuplicateLedgerTransactionError);

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
