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
  refundFreezeDebit,
  platformFeePortionFor,
  providerFeePortionFor,
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
import { canonicalPaymentProviderName } from '@/lib/payments/provider-names';
import { ledgerGroupBy } from '../../../tests/support/ledger-group-by';

/**
 * A Payment Provider name written onto something in this file, in any quote
 * style. The backreference is what makes it safe to point at itself: the
 * pattern's own text has no matching pair of quotes around a name, so the scan
 * below never reads its own source.
 */
const STAMPED_PROVIDER = /provider:\s*(['"`])([^'"`]+)\1/g;

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
      groupBy: vi.fn(ledgerGroupBy(rows)),
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

  /**
   * The direction every leg in a source gives the Collection Account.
   *
   * Paired by proximity, not by one literal shape, because a scan that only
   * recognises the shape in use today reads every other shape as "nothing to
   * complain about" -- and a leg it cannot read is a leg it cannot refuse.
   *
   * `amount:` is what tells a leg from a filter. Every leg has one
   * (postTransaction refuses an amount that is not whole rupiah) and a filter
   * has none, so `accountTotal(tx, { account: 'COLLECTION_ACCOUNT' }, 'debit')`
   * is a reader and is left alone. A leg whose direction is not a literal --
   * `{ account: 'COLLECTION_ACCOUNT', direction: dir, amount }` -- is reported
   * as UNREADABLE rather than passed over, because the alternative is a claim
   * of "nothing credits this account" resting on a scan that did not read it.
   */
  const UNREADABLE = 'UNREADABLE-DIRECTION';
  const DIRECTION_LITERAL = /direction:\s*(['"])(\w+)\1/;
  const AMOUNT_LITERAL = /\bamount\b\s*:/;

  function collectionAccountDirections(source: string): string[] {
    // Block comments go first: this account is named in prose in ledger.ts's own
    // doc blocks, and prose is not a leg. Line comments are left alone on
    // purpose -- a `//` inside a URL string would take the rest of the line with
    // it, and a leg is never written on a line with a URL.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

    return [...code.matchAll(/(['"])COLLECTION_ACCOUNT\1/g)].flatMap((account) => {
      // The braces around the name are its own leg's: a leg literal is flat, so
      // the nearest `{` before it and the nearest `}` after it are its edges.
      const open = code.lastIndexOf('{', account.index);
      const close = code.indexOf('}', account.index);
      const leg = open === -1 || close === -1 ? '' : code.slice(open, close + 1);

      const direction = DIRECTION_LITERAL.exec(leg);
      if (direction) return [direction[2]];
      return AMOUNT_LITERAL.test(leg) ? [UNREADABLE] : [];
    });
  }

  it('has no movement that can credit the Collection Account, which is what makes the test above a seeded state', async () => {
    // The premise of the seeded-CREDIT test, asserted rather than left in a
    // comment. A leg builder naming this account is the only way a row can
    // reach it, and every one of them debits it, so "no builder produces a
    // credit here" is checkable -- and when a movement that credits the account
    // is ever added (a corrected sweep, a clawback), this fails and the seeded
    // test's title has to be re-read rather than quietly left standing.
    //
    // EVERY module of the money layer, not ledger.ts alone. The scan used to
    // read one file, so a leg added to refunds.ts or provider-withdrawals.ts --
    // exactly where a corrected sweep or a clawback would go -- was never read,
    // and the claim above was reported as true because the scan had not looked.
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'src', 'lib', 'money');
    const modules = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

    const directions = modules.flatMap((name) =>
      collectionAccountDirections(readFileSync(join(dir, name), 'utf8')),
    );

    // Greater than zero, so a leg written in some other shape cannot make this
    // pass by finding nothing to complain about -- and with the shape check
    // below, so a shape the scan cannot read cannot make it pass either.
    expect(directions.length).toBeGreaterThan(0);
    expect([...new Set(directions)]).toEqual(['DEBIT']);
  });

  it('reads a Collection Account leg in every shape the money layer writes one, so the scan above is not one literal deep', () => {
    // The guard on the guard. The old pattern was
    // `account: 'COLLECTION_ACCOUNT',\s*direction: '(\w+)'` over one file, and
    // it had two holes this file proves: a leg in double quotes or with the
    // direction written first was skipped rather than refused. Skipped is the
    // dangerous direction -- the scan reports "no credit here" for a leg that
    // does credit the account, and the test above stays green.
    //
    // Each shape below is one a contributor or a formatter can produce from the
    // shape the repo uses today, and none of them is a leg the ledger must not
    // have: all of them credit this account, so all of them must be read.
    for (const credit of [
      "{ account: 'COLLECTION_ACCOUNT', direction: 'CREDIT', amount: 1 }",
      '{ account: "COLLECTION_ACCOUNT", direction: "CREDIT", amount: 1 }',
      "{ direction: 'CREDIT', account: 'COLLECTION_ACCOUNT', amount: 1 }",
      "{\n  account: 'COLLECTION_ACCOUNT',\n  direction: 'CREDIT',\n  amount: 1,\n}",
      "function sweep() {\n  return [{ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 1 }, { account: 'COLLECTION_ACCOUNT', direction: 'CREDIT', amount: 1 }];\n}",
    ]) {
      expect(collectionAccountDirections(credit)).toEqual(['CREDIT']);
    }

    // And a doc block that merely NAMES the account is not a leg. ledger.ts
    // prints this account in a table in the sweep builder's comment, so the scan
    // strips block comments first: without that, the prose is read as a leg and
    // paired with whatever direction happened to follow it.
    expect(
      collectionAccountDirections(
        "/**\n *   DEBIT  COLLECTION_ACCOUNT  amount   the money reached a bank\n */\n",
      ),
    ).toEqual([]);
  });

  /**
   * The claim is written in TWO places -- the enum member in schema.prisma and
   * the reader in ledger.ts -- and it was contradicted in BOTH. A guard that
   * reads one of them is green while the other copy says the opposite, which is
   * how "only ever grows" was deleted from the schema and survived two lines
   * below a paragraph saying the sweep DEBITS the account. So both files are
   * read here, from one table, against the same two rules: the doc may not deny
   * the debit, and it must still say which way the figure is read, so deleting
   * the false claim cannot pass by deleting the answer with it.
   *
   * One table rather than a per-file `it` block on purpose: a block per file
   * can lose one file to an edit and leave the other passing, which is the
   * failure this table exists to make impossible to overlook.
   */
  const DOC_BLOCKS = [
    {
      place: 'the enum member in prisma/schema.prisma',
      source: `${process.cwd()}/prisma/schema.prisma`,
      // The enum member's OWN doc block: every `///` line between the last
      // non-comment line and the member, not one of the paragraphs on the way
      // up to it. A bare `///` paragraph break is part of the block, so the
      // run matches `///` with or without text after it.
      pattern: /\n((?: {2}\/\/\/.*\n)+) {2}COLLECTION_ACCOUNT\n/,
    },
    {
      place: 'collectionAccountBalance in src/lib/money/ledger.ts',
      source: `${process.cwd()}/src/lib/money/ledger.ts`,
      // The nearest `/** ... */` before the declaration, which is that
      // function's own doc block rather than one of the paragraphs on the way
      // up to it: `[\s\S]*?` is lazy, so it stops at the first `*/`.
      pattern: /\/\*\*([\s\S]*?)\*\/\nexport async function collectionAccountBalance\b/,
    },
  ];

  it.each(DOC_BLOCKS)(
    'documents the one direction this account has, in $place, with nothing left that argues with it',
    async ({ source, pattern }) => {
      // The disagreement this repo had about the Collection Account was never in
      // the code -- it always DEBITS, read debits - credits, which is what
      // collectionAccountBalance does and what the two tests above pin. It was
      // in the comments, which said the account was "only ever grows" and that
      // "nothing debits this account" in the same breath as the sweep DEBITS
      // it. Both halves cannot be true, and a reader who has to choose ends up
      // choosing a half.
      //
      // So the claim is pinned where it is written rather than left to be
      // resolved by whoever opens the file next. Every phrasing of the growth
      // claim is named, not just the one that was there: the wording is what
      // gets re-invented, and a guard against one string guards one string.
      const { readFileSync } = await import('node:fs');
      const doc = pattern.exec(readFileSync(source, 'utf8'));
      expect(doc).not.toBeNull();
      const comment = doc![1];

      for (const denial of [
        /only ever grows/i,
        /only ever rises/i,
        /nothing debits/i,
        /never (?:is )?debited/i,
      ]) {
        expect(comment).not.toMatch(denial);
      }
      expect(comment).toMatch(/debits\s*-\s*credits/i);
    },
  );
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
      { provider: 'mock' },
    );
    await postTransaction(tx as never, payoutCompletedLegs({ amount: 120_000 }));

    // Named providers in name order, the unnamed bucket last -- which is the
    // order providerBalances sorts to, so the expectation is the documented
    // one and not the order the rows happen to be posted in.
    expect(await providerBalances(tx as never)).toEqual([
      { provider: 'mock', debited: 200_000, credited: 0, balance: 200_000 },
      { provider: 'sumopod', debited: 500_000, credited: 0, balance: 500_000 },
      { provider: null, debited: 0, credited: 120_000, balance: -120_000 },
    ]);
  });

  it('keeps a withdrawal against the provider it was drawn from, so the pot shrinks for that provider only', async () => {
    // `mock` is the other name this build has a provider for, which is what a
    // second pot has to be: the split is by exact string equality, so the point
    // of the test is two names, and only registered ones are states the
    // platform can be in. The guard at the end of this describe says so.
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 0 }),
      { provider: 'sumopod' },
    );
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c2' }, grossAmount: 900_000, providerFee: 0 }),
      { provider: 'mock' },
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
    expect(pots.find((p) => p.provider === 'mock')?.balance).toBe(900_000);
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

  it('stamps only names this build has a provider for, because a pot split by an unknown name is a pot nothing can settle', async () => {
    // The fixtures above used to file money under a provider this build has no
    // adapter for, which made this file disagree with payouts.test.ts and
    // provider-withdrawals.test.ts about whether that name exists. The rule ADR
    // 0006 gave us is a closed list (@/lib/payments/provider-names), and a test
    // that quietly posts a name off the list is testing a state the platform
    // cannot reach: the Provider Balance is split by exact string equality, so
    // such a bucket reconciles perfectly against nothing and settles against
    // no code path at all. Green tests, no evidence.
    //
    // A name can only reach a ledger entry through this file, so the fixtures
    // are the whole surface, and they are checked against the registry rather
    // than against a list written here. The two files that post an unregistered
    // name on purpose -- to prove approvePayout and recordProviderWithdrawal
    // refuse one -- are not this file's business; this file has no such claim
    // to make.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'money', 'ledger.test.ts'), 'utf8');

    const stamped = [...new Set([...source.matchAll(STAMPED_PROVIDER)].map((m) => m[2]))];
    // Greater than zero, so a rewrite of the pattern cannot make this pass by
    // finding no provider name to complain about.
    expect(stamped.length).toBeGreaterThan(0);

    const unknown = stamped.filter((name) => {
      try {
        canonicalPaymentProviderName(name);
        return false;
      } catch {
        return true;
      }
    });
    expect(unknown).toEqual([]);
  });

  it('reads a stamped provider name in every quote style, so an unregistered one cannot be written in another', () => {
    // The guard on the guard. The pattern used to read single quotes and
    // nothing else, so a fixture that wrote the name in double quotes posted
    // an unregistered name onto a ledger entry and the check above passed,
    // because that name was not a name to it. A scan that cannot see a shape
    // reports the shape as absent, which is the one answer always wrong here.
    //
    // The names below are registered ones on purpose. This file is its own
    // input: the check above scans it, so an unregistered name written here as
    // an example would be posted money filed under a provider this build has no
    // adapter for -- and, more to the point, would make the two tests fail each
    // other instead of saying anything about the pattern.
    expect([...`{ provider: 'sumopod' }`.matchAll(STAMPED_PROVIDER)].map((m) => m[2])).toEqual(['sumopod']);
    expect([...`{ provider: "sumopod" }`.matchAll(STAMPED_PROVIDER)].map((m) => m[2])).toEqual(['sumopod']);
    expect([...'{ provider: `sumopod` }'.matchAll(STAMPED_PROVIDER)].map((m) => m[2])).toEqual(['sumopod']);
    // And it still does not read its own source: the capture group is behind a
    // backreference, so the text of the pattern in this file is not a name.
    expect([...STAMPED_PROVIDER.source.matchAll(STAMPED_PROVIDER)]).toEqual([]);
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

  it('refuses a freeze whose two fee portions together exceed the amount refunded, rather than debit the pool a negative net portion', () => {
    const subject = { type: 'campaign' as const, campaignId: 'c1' };
    // A Refund of 1_000 cannot give up 600 of Platform Fee and 500 of Provider
    // Fee: the pool would be debited -100, and without the refusal the legs
    // post 1_100 of debits against a 1_000 credit.
    expect(() =>
      refundRequestedLegs({ subject, amount: 1_000, source: 'ESCROW_HOLD', platformFeePortion: 600, providerFeePortion: 500 }),
    ).toThrow(InvalidLedgerLegError);
    // Exactly the amount is allowed: the net portion is 0 and posts no pool leg.
    expect(
      refundRequestedLegs({ subject, amount: 1_000, source: 'ESCROW_HOLD', platformFeePortion: 600, providerFeePortion: 400 }),
    ).toEqual([
      { account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 1_000, campaignId: 'c1' },
      { account: 'PLATFORM_FEE', direction: 'DEBIT', amount: 600 },
      { account: 'REFUND_COST', direction: 'DEBIT', amount: 400 },
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

describe('refundFreezeDebit (prd-compliance 51)', () => {
  // Two 50_000 Refunds on a Payment of 100_000 with a Provider Fee of 3_333 and a
  // Platform Fee of 1_667, both open at once. The first is frozen against no
  // earlier Refund (shares of 834 and 1_667, a debit of 47_499); the second with
  // the first still counted, so the cumulative cap cuts its shares to 833 and
  // 1_666 and it debits 47_501.
  const entry = (
    transactionId: string,
    account: LedgerLeg['account'],
    direction: LedgerLeg['direction'],
    amount: number,
  ) => ({ transactionId, account, direction, amount });

  const entries = [
    entry('settle-1', 'ESCROW_HOLD', 'CREDIT', 95_000),
    entry('refund-requested-refund-1', 'FROZEN_BALANCE', 'CREDIT', 50_000),
    entry('refund-requested-refund-1', 'ESCROW_HOLD', 'DEBIT', 47_499),
    entry('refund-requested-refund-1', 'PLATFORM_FEE', 'DEBIT', 834),
    entry('refund-requested-refund-1', 'REFUND_COST', 'DEBIT', 1_667),
    entry('refund-requested-refund-2', 'FROZEN_BALANCE', 'CREDIT', 50_000),
    entry('refund-requested-refund-2', 'ESCROW_HOLD', 'DEBIT', 47_501),
    entry('refund-requested-refund-2', 'PLATFORM_FEE', 'DEBIT', 833),
    entry('refund-requested-refund-2', 'REFUND_COST', 'DEBIT', 1_666),
    // What happened to the first afterwards: rejected, its freeze mirrored back out.
    entry('refund-rejected-refund-1', 'ESCROW_HOLD', 'CREDIT', 47_499),
    entry('refund-rejected-refund-1', 'REFUND_COST', 'CREDIT', 1_667),
  ];

  it("reads the debit a Refund's freeze posted to an account, whatever else is in the ledger", () => {
    expect(refundFreezeDebit(entries, 'refund-2', 'ESCROW_HOLD')).toBe(47_501);
    expect(refundFreezeDebit(entries, 'refund-2', 'PLATFORM_FEE')).toBe(833);
    expect(refundFreezeDebit(entries, 'refund-2', 'REFUND_COST')).toBe(1_666);
  });

  it("keeps one Refund's freeze apart from another's, and from the credits and journals that came after it", () => {
    // refund-1's freeze, not its rejection (which credits the same accounts back) and not refund-2's.
    expect(refundFreezeDebit(entries, 'refund-1', 'ESCROW_HOLD')).toBe(47_499);
    expect(refundFreezeDebit(entries, 'refund-1', 'REFUND_COST')).toBe(1_667);
    // FROZEN_BALANCE is only ever credited by a freeze, so there is no debit to read.
    expect(refundFreezeDebit(entries, 'refund-1', 'FROZEN_BALANCE')).toBe(0);
  });

  it('adds up the debit legs when the freeze posted more than one to the same account', () => {
    expect(
      refundFreezeDebit(
        [
          entry('refund-requested-refund-3', 'ESCROW_HOLD', 'DEBIT', 30_000),
          entry('refund-requested-refund-3', 'ESCROW_HOLD', 'DEBIT', 12_000),
        ],
        'refund-3',
        'ESCROW_HOLD',
      ),
    ).toBe(42_000);
  });

  it('reads 0 for an account the freeze posted nothing to, and for a Refund whose freeze is not there at all', () => {
    expect(refundFreezeDebit(entries, 'refund-1', 'CAMPAIGN_BALANCE')).toBe(0);
    // The same 0 for a Refund the entries know nothing about, which is why a caller that cares asks for the journal first.
    expect(refundFreezeDebit(entries, 'refund-unknown', 'ESCROW_HOLD')).toBe(0);
  });

  it('agrees with the legs refundRequestedLegs builds, account by account', () => {
    const legs = refundRequestedLegs({
      subject: { type: 'trip', tripId: 't1' },
      amount: 50_000,
      source: 'TRIP_BALANCE',
      platformFeePortion: 0,
      providerFeePortion: 1_666,
    });
    const posted = legs.map((leg) => ({ transactionId: 'refund-requested-refund-5', ...leg }));

    expect(refundFreezeDebit(posted, 'refund-5', 'TRIP_BALANCE')).toBe(48_334);
    expect(refundFreezeDebit(posted, 'refund-5', 'REFUND_COST')).toBe(1_666);
    expect(refundFreezeDebit(posted, 'refund-5', 'PLATFORM_FEE')).toBe(0);
  });
});

describe('platformFeePortionFor and providerFeePortionFor (prd-compliance 53)', () => {
  // Gross 100_000, Provider Fee 3_333, Platform Fee 1_667: neither fee splits
  // evenly across two 50_000 Refunds (1_666.5 and 833.5).
  const payment = { amount: 100_000, providerFee: 3_333, platformFee: 1_667 };
  const standing = (amount: number, platformFeePosted: number, providerFeePosted: number) => ({
    amount,
    platformFeePosted,
    providerFeePosted,
  });

  it('gives a Refund with nothing else standing the rounded-up proportional share of its own amount', () => {
    expect(providerFeePortionFor(payment, 50_000, [])).toBe(1_667);
    expect(platformFeePortionFor(payment, 50_000, [])).toBe(834);
    expect(providerFeePortionFor(payment, 100_000, [])).toBe(3_333);
    expect(platformFeePortionFor(payment, 100_000, [])).toBe(1_667);
  });

  it('reads a missing Platform Fee as 0, the way every other reader of the field does', () => {
    expect(platformFeePortionFor({ amount: 100_000, platformFee: null }, 50_000, [])).toBe(0);
    expect(platformFeePortionFor({ amount: 100_000, platformFee: undefined }, 50_000, [])).toBe(0);
  });

  it('caps what the standing Refunds and this one carry at the fee: the second 50_000 Refund takes what the first left', () => {
    expect(providerFeePortionFor(payment, 50_000, [standing(50_000, 834, 1_667)])).toBe(1_666);
    expect(platformFeePortionFor(payment, 50_000, [standing(50_000, 834, 1_667)])).toBe(833);
  });

  it('adds one rounded-up share per Refund and cuts only the last: 50_000, 40_000 and 10_000', () => {
    const first = standing(50_000, 834, 1_667);
    // 3_333 over 40_000 is 1_333.2 and 1_667 over it 666.8: rounded up, 1_334 and 667.
    expect(providerFeePortionFor(payment, 40_000, [first])).toBe(1_334);
    expect(platformFeePortionFor(payment, 40_000, [first])).toBe(667);
    // 10_000 would carry 334 and 167 by itself; only 332 and 166 are left.
    const second = standing(40_000, 667, 1_334);
    expect(providerFeePortionFor(payment, 10_000, [first, second])).toBe(332);
    expect(platformFeePortionFor(payment, 10_000, [first, second])).toBe(166);
  });

  it('measures what is missing against what the standing Refunds posted, not against what their amounts would give', () => {
    // A 50_000 Refund stands whose freeze was cut to 833 and 1_666 (another
    // Refund held the rest when it was frozen, and has since been rejected). The
    // next 50_000 Refund takes the rupiah that was cut. Worked out from the
    // standing amount alone the standing Refund would have carried 834 and 1_667,
    // and the next one only 833 and 1_666.
    expect(providerFeePortionFor(payment, 50_000, [standing(50_000, 833, 1_666)])).toBe(1_667);
    expect(platformFeePortionFor(payment, 50_000, [standing(50_000, 833, 1_666)])).toBe(834);
  });

  it('takes up a share that was cut from a Refund that still stands, on top of its own', () => {
    // 25_000 stands, cut to 416 and 832 (its own shares are 417 and 834). The
    // 75_000 that is left has shares of 1_251 and 2_500 of its own, and takes up
    // the cut on top: the Payment's 1_667 and 3_333 less what stands.
    expect(platformFeePortionFor(payment, 75_000, [standing(25_000, 416, 832)])).toBe(1_251);
    expect(providerFeePortionFor(payment, 75_000, [standing(25_000, 416, 832)])).toBe(2_501);
  });

  it('is 0 once the standing Refunds have posted the whole fee', () => {
    expect(providerFeePortionFor(payment, 10_000, [standing(90_000, 1_500, 3_333)])).toBe(0);
    expect(platformFeePortionFor(payment, 10_000, [standing(90_000, 1_667, 3_000)])).toBe(0);
  });

  it('is 0 when the Payment carries no such fee', () => {
    expect(providerFeePortionFor({ amount: 100_000, providerFee: 0 }, 40_000, [standing(10_000, 0, 0)])).toBe(0);
  });

  it('gives the next Refund nothing, never a negative share, once the standing Refunds carry more than the cumulative portion', () => {
    // A Payment of 10_000 with a Provider Fee of 10: a Refund of 1_000 carries 1,
    // rounded up. Three Refunds open one after the other, each frozen with the
    // earlier ones standing: 1_010 carries 2, 100 carries 1, and 8_001 carries 7,
    // its own 9 less the 2 that the first two already took.
    const small = { amount: 10_000, providerFee: 10 };
    expect(providerFeePortionFor(small, 1_010, [])).toBe(2);
    expect(providerFeePortionFor(small, 100, [standing(1_010, 0, 2)])).toBe(1);
    expect(providerFeePortionFor(small, 8_001, [standing(1_010, 0, 2), standing(100, 0, 1)])).toBe(7);

    // The first two are rejected, so only the 8_001 stands, with its 7. A Refund
    // of 100 takes up the 2 that were cut from it, on top of its own 1.
    expect(providerFeePortionFor(small, 100, [standing(8_001, 0, 7)])).toBe(3);

    // Then the 8_001 is rejected too. The Refund of 100 keeps the 3 it posted,
    // where the cumulative portion of that 100 and the next 100 is only 2, so
    // there is nothing missing: the next Refund of 100 takes 0, not -1. The two
    // carry 3 between them, one more than the cumulative portion and well under
    // the fee of 10.
    expect(providerFeePortionFor(small, 100, [standing(100, 0, 3)])).toBe(0);
  });

  it('never carries more than the Refund\'s own amount, however much is missing', () => {
    // A 10-rupiah Payment whose whole value is Provider Fee, with 9 of it
    // standing and none of the fee posted: everything is missing, but a 1-rupiah
    // Refund can carry 1.
    expect(providerFeePortionFor({ amount: 10, providerFee: 10 }, 1, [standing(9, 0, 0)])).toBe(1);
  });

  // The invariants the tests above and the Postgres tests state with figures, over
  // any Payment and any run of Refunds created and rejected (prd-compliance 49 and
  // 53). The fees are a per-mille share of the Gross, the Provider Fee up to 6% and
  // the Platform Fee up to 10%. A Refund of less than MIN_REFUND is not generated:
  // a Refund cannot carry more fee than its own amount, so a handful of rupiah
  // could not carry the rupiah or two a catch-up adds on each of two fees, and a
  // Refund that small is not a case this arithmetic is meant to settle.
  const MIN_REFUND = 100;
  const ceilDiv = (numerator: number, denominator: number) =>
    Number((BigInt(numerator) + BigInt(denominator) - BigInt(1)) / BigInt(denominator));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  it('property: Refunds standing together carry at least the cumulative portion of each fee and never more than the fee, and never take more out of the pool than it held', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10_000, max: 5_000_000 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 100 }),
        fc.array(
          fc.record({
            reject: fc.boolean(),
            permille: fc.integer({ min: 1, max: 1_000 }),
            pick: fc.nat(),
          }),
          { minLength: 1, maxLength: 16 },
        ),
        (gross, providerPermille, platformPermille, operations) => {
          const fees = {
            providerFee: Math.floor((gross * providerPermille) / 1_000),
            platformFee: Math.floor((gross * platformPermille) / 1_000),
          };
          const paymentUnderTest = { amount: gross, ...fees };
          const standingRefunds: Array<{ amount: number; platform: number; provider: number }> = [];
          let anyRejected = false;

          for (const operation of operations) {
            if (operation.reject) {
              if (standingRefunds.length > 0) {
                standingRefunds.splice(operation.pick % standingRefunds.length, 1);
                anyRejected = true;
              }
              continue;
            }
            const remaining = gross - sum(standingRefunds.map((r) => r.amount));
            if (remaining < MIN_REFUND) continue;
            const amount = Math.max(MIN_REFUND, Math.floor((remaining * operation.permille) / 1_000));

            const others = standingRefunds.map((r) => ({
              amount: r.amount,
              platformFeePosted: r.platform,
              providerFeePosted: r.provider,
            }));
            const platform = platformFeePortionFor(paymentUnderTest, amount, others);
            const provider = providerFeePortionFor(paymentUnderTest, amount, others);
            standingRefunds.push({ amount, platform, provider });

            // A Refund never carries a negative share, nor more than its own amount.
            expect(platform).toBeGreaterThanOrEqual(0);
            expect(provider).toBeGreaterThanOrEqual(0);
            expect(amount - platform - provider).toBeGreaterThanOrEqual(0);

            // The cumulative portion of a fee is the sum of the standing Refunds'
            // rounded-up shares, capped at the fee. What they carry is never less
            // than that and never more than the fee. It is exactly that until a
            // Refund is rejected: after one, it can sit a rupiah or two above, since
            // a share taken up for a Refund that is rejected later stays posted with
            // the Refund that took it, and the next Refund then takes none.
            const cumulative = (fee: number) =>
              Math.min(fee, sum(standingRefunds.map((r) => ceilDiv(fee * r.amount, gross))));
            const carried = {
              platform: sum(standingRefunds.map((r) => r.platform)),
              provider: sum(standingRefunds.map((r) => r.provider)),
            };
            expect(carried.platform).toBeGreaterThanOrEqual(cumulative(fees.platformFee));
            expect(carried.platform).toBeLessThanOrEqual(fees.platformFee);
            expect(carried.provider).toBeGreaterThanOrEqual(cumulative(fees.providerFee));
            expect(carried.provider).toBeLessThanOrEqual(fees.providerFee);
            if (!anyRejected) {
              expect(carried.platform).toBe(cumulative(fees.platformFee));
              expect(carried.provider).toBe(cumulative(fees.providerFee));
            }
            // So the pool, which held the Gross less both fees, is never debited
            // more than it held.
            const taken = sum(standingRefunds.map((r) => r.amount - r.platform - r.provider));
            expect(taken).toBeLessThanOrEqual(gross - fees.platformFee - fees.providerFee);
            // A Payment refunded in full has handed back every rupiah of both fees.
            if (sum(standingRefunds.map((r) => r.amount)) === gross) {
              expect(carried.platform).toBe(fees.platformFee);
              expect(carried.provider).toBe(fees.providerFee);
            }
          }
        },
      ),
      {
        numRuns: 3_000,
        examples: [
          // The review of PR #208: a Payment of 10_000 with a fee of 10, Refunds of
          // 1_010, 100 and 8_001, the first two rejected, then 100, then the 8_001
          // rejected, then 100 again.
          [
            10_000,
            1,
            0,
            [
              { reject: false, permille: 101, pick: 0 },
              { reject: false, permille: 11, pick: 0 },
              { reject: false, permille: 900, pick: 0 },
              { reject: true, permille: 1, pick: 0 },
              { reject: true, permille: 1, pick: 0 },
              { reject: false, permille: 1, pick: 0 },
              { reject: true, permille: 1, pick: 0 },
              { reject: false, permille: 1, pick: 0 },
            ],
          ],
        ],
      },
    );
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

  it('a Program credited then reversed in parts reads back the model balance from the ledger, and debits equal credits', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.array(fc.integer({ min: 1, max: 1_000_000_000 }), { maxLength: 5 }),
        async (credit, attempts) => {
          const tx = makeTx();
          const subject: ManualContributionSubject = { type: 'program', programId: 'p1' };
          await postTransaction(tx as never, manualContributionReceivedLegs({ subject, amount: credit }));

          // The model: what was credited less what was reversed. The ledger
          // is asked for the balance and must agree at every step. Reversals
          // here stay within the credit so the model is a plain subtraction;
          // whether the ledger should refuse an over-reversal is an owner
          // decision, not something this property claims.
          let modelBalance = credit;
          for (const attempt of attempts) {
            const amount = Math.min(attempt, modelBalance);
            if (amount === 0) continue; // nothing left to reverse
            await postTransaction(tx as never, manualContributionReversedLegs({ subject, amount }));
            modelBalance -= amount;
            expect(await programBalance(tx as never, 'p1')).toBe(modelBalance);
          }

          const debits = tx.rows.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
          const credits = tx.rows.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0);
          expect(debits).toBe(credits);
          expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
