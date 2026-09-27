import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordProviderWithdrawal,
  reconcileProviderBalances,
  ProviderWithdrawalAmountError,
  ProviderWithdrawalDuplicateError,
  ProviderWithdrawalInputError,
  ProviderWithdrawalNotFoundError,
  ProviderWithdrawalProofRequiredError,
} from './provider-withdrawals';

/**
 * The sweep from the payment provider to the Collection Account, and the
 * reconciliation that reads it back (prd-compliance 35; PRD FFI-07; ADR 0011).
 *
 * Two seams, because two different questions are being asked of this module.
 *
 *   recordProviderWithdrawal is the write: one Admin, a provider reference, the
 *   two dashboard readings either side of the movement, and a balanced journal
 *   that moves the money from the Provider Balance to the bank. The seam is the
 *   exported function, driven against a fake transaction client that runs the
 *   real ledger, so the posted legs are asserted rather than the call.
 *
 *   reconcileProviderBalances is the read, and it is where this ticket's actual
 *   promise lives: the difference between the provider and the bank becomes
 *   visible instead of assumed. The tests below are about what it refuses to
 *   claim as much as about what it reports.
 */

type LedgerRow = {
  account: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  provider: string | null;
  providerWithdrawalId: string | null;
  transactionId: string;
  campaignId: string | null;
  volunteerTripId: string | null;
  programId: string | null;
};

type WithdrawalRow = {
  id: string;
  provider: string;
  reference: string;
  amount: number;
  destinationName: string;
  collectingEntityId: string | null;
  providerBalanceBefore: number;
  providerBalanceAfter: number;
  proofReference: string;
  recordedById: string;
  recordedAt: Date;
};

let rows: WithdrawalRow[] = [];
let ledgerRows: LedgerRow[] = [];
let references: Set<string> = new Set();
let partnerOrganisations: Set<string> = new Set();
let withdrawalCounter = 0;

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

/**
 * A fake tx client running the real ledger: `createMany` writes the rows and
 * refuses a ProviderWithdrawal reference twice, which is the claim that makes
 * recording a given sweep happen once ever (Prisma's P2002, shaped the way it
 * is really reported).
 */
function makeTx() {
  return {
    providerWithdrawal: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (references.has(String(data.reference))) throw uniqueViolation();
        references.add(String(data.reference));
        const row = { id: `pw-${++withdrawalCounter}`, recordedAt: new Date('2026-09-30T00:00:00Z'), ...data } as WithdrawalRow;
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async () => rows.slice().sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())),
    },
    partnerOrganisation: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        partnerOrganisations.has(where.id) ? { id: where.id, name: 'Yayasan unlucky' } : null,
      ),
    },
    ledgerEntry: {
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        ledgerRows.push(...data);
        return { count: data.length };
      }),
      // One bucket per (provider, direction), the shape ledger.ts's
      // providerBalances and this module's reconciliation both read.
      groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
        const buckets = new Map<string, { row: Record<string, unknown>; sum: number }>();
        for (const row of ledgerRows) {
          const w = args.where ?? {};
          if (!Object.entries(w).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)) continue;
          const key = args.by.map((k) => String((row as unknown as Record<string, unknown>)[k])).join('|');
          const bucket = buckets.get(key) ?? {
            row: Object.fromEntries(args.by.map((k) => [k, (row as unknown as Record<string, unknown>)[k]])),
            sum: 0,
          };
          bucket.sum += row.amount;
          buckets.set(key, bucket);
        }
        return Array.from(buckets.values()).map((b) => ({ ...b.row, _sum: { amount: b.sum } }));
      }),
    },
    campaign: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    payment: { findMany: vi.fn(async () => []) },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    $transaction: vi.fn(async (cb: (client: unknown) => unknown) => cb(tx)),
    providerWithdrawal: { findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id)) },
  };
}

const ADMIN = 'admin-1';

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'sumopod',
    reference: 'SP-2026-09-30-001',
    amount: 750_000,
    destinationName: 'Yayasan Sehat Mandiri',
    collectingEntityId: 'org-1',
    providerBalanceBefore: 1_200_000,
    providerBalanceAfter: 450_000,
    proofReference: 'dokumen/sweep-001.pdf',
    recordedById: ADMIN,
    ...overrides,
  };
}

beforeEach(() => {
  rows = [];
  ledgerRows = [];
  references = new Set();
  partnerOrganisations = new Set(['org-1']);
  withdrawalCounter = 0;
});

describe('recordProviderWithdrawal', () => {
  it('posts a balanced journal that moves the money out of the Provider Balance and into the bank', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);

    const withdrawal = await recordProviderWithdrawal(prisma as never, validInput());

    expect(withdrawal.id).toBe('pw-1');
    expect(tx.ledgerEntry.createMany).toHaveBeenCalledTimes(1);
    expect(ledgerRows).toEqual([
      expect.objectContaining({ account: 'COLLECTION_ACCOUNT', direction: 'DEBIT', amount: 750_000 }),
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 750_000 }),
    ]);
    // Balanced, and stated as a fact rather than assumed from the two legs
    // summing the same.
    const debits = ledgerRows.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(ledgerRows.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amount, 0));
  });

  it('stamps the provider and the withdrawal on every leg, so the pot shrinks for that provider and the movement can be attributed', async () => {
    const tx = makeTx();

    await recordProviderWithdrawal(makePrisma(tx) as never, validInput());

    // Without provider on both legs, providerBalances cannot split the pot and
    // a report would be reconciling a total against a per-provider reading.
    expect(ledgerRows.every((r) => r.provider === 'sumopod')).toBe(true);
    // Without the withdrawal id, the reconciliation would have to guess which
    // recorded sweep a given pot movement belonged to.
    expect(ledgerRows.every((r) => r.providerWithdrawalId === 'pw-1')).toBe(true);
  });

  it('posts under a transactionId derived from the withdrawal it created, so the ledger claim makes the post one-shot', async () => {
    const tx = makeTx();

    await recordProviderWithdrawal(makePrisma(tx) as never, validInput());

    // The claim on this id is the ledger's own (prd-compliance 28b), and the
    // reference's unique index is the claim that stops a second sweep being
    // recorded at all -- two different guards, because they refuse two
    // different things.
    expect(ledgerRows.every((r) => r.transactionId === 'provider-withdrawal-pw-1')).toBe(true);
  });

  it('refuses a second recording of the same provider reference, and posts nothing for it', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    await recordProviderWithdrawal(prisma as never, validInput());

    await expect(recordProviderWithdrawal(prisma as never, validInput())).rejects.toThrow(
      ProviderWithdrawalDuplicateError,
    );
    // One sweep, one journal. A retry of the same disbursement must not take
    // the money out of the pot a second time.
    expect(rows).toHaveLength(1);
    expect(ledgerRows).toHaveLength(2);
  });

  it('records a sweep whose destination is a registered Collecting Entity, and one whose destination is not', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);

    await recordProviderWithdrawal(prisma as never, validInput({ reference: 'SP-1' }));
    // ADR 0011's whole point: the collection account may belong to a different
    // legal entity than the Merchant Account, so the entity is recorded -- and
    // its absence is allowed, because a sweep to the platform's own bank is a
    // real thing that is not a Partner Organisation.
    await recordProviderWithdrawal(prisma as never, validInput({ reference: 'SP-2', collectingEntityId: null }));

    expect(rows.map((r) => r.collectingEntityId)).toEqual(['org-1', null]);
  });

  it('refuses a collecting entity that does not exist, rather than storing an id that names nothing', async () => {
    const tx = makeTx();

    await expect(
      recordProviderWithdrawal(makePrisma(tx) as never, validInput({ collectingEntityId: 'org-does-not-exist' })),
    ).rejects.toThrow(ProviderWithdrawalNotFoundError);
    expect(rows).toHaveLength(0);
    expect(ledgerRows).toHaveLength(0);
  });

  it('refuses a sweep with no evidence, for the same reason a Payout completion does', async () => {
    const tx = makeTx();

    await expect(
      recordProviderWithdrawal(makePrisma(tx) as never, validInput({ proofReference: '   ' })),
    ).rejects.toThrow(ProviderWithdrawalProofRequiredError);
    expect(rows).toHaveLength(0);
  });

  it('refuses a sweep with no provider named, because a reading nobody can attribute to a provider is not a reading', async () => {
    const tx = makeTx();

    await expect(
      recordProviderWithdrawal(makePrisma(tx) as never, validInput({ provider: '  ' })),
    ).rejects.toThrow(ProviderWithdrawalInputError);
    expect(rows).toHaveLength(0);
  });

  it('refuses a destination with no name, because "somewhere" is not an account', async () => {
    const tx = makeTx();

    await expect(
      recordProviderWithdrawal(makePrisma(tx) as never, validInput({ destinationName: '' })),
    ).rejects.toThrow(ProviderWithdrawalInputError);
  });

  it('refuses an amount that is not whole rupiah above zero', async () => {
    const tx = makeTx();
    for (const amount of [0, -1, 1000.5]) {
      await expect(
        recordProviderWithdrawal(makePrisma(tx) as never, validInput({ amount })),
      ).rejects.toThrow(ProviderWithdrawalAmountError);
    }
    expect(rows).toHaveLength(0);
  });

  it('refuses a dashboard reading that is not a whole non-negative rupiah amount', async () => {
    const tx = makeTx();
    // A negative "balance" is not a reading of anything. It is refused rather
    // than stored, because a stored negative would reconcile against a pot
    // and look like a provider owing the platform money.
    for (const providerBalanceBefore of [-1, 1000.5]) {
      await expect(
        recordProviderWithdrawal(makePrisma(tx) as never, validInput({ providerBalanceBefore })),
      ).rejects.toThrow(ProviderWithdrawalAmountError);
    }
    expect(rows).toHaveLength(0);
  });

  it('accepts a sweep whose two readings do not differ by the amount -- and leaves the gap for the reconciliation to report', async () => {
    // The provider charged a fee on the transfer, so its balance fell by more
    // than we took. Refusing this would refuse an honest record of exactly the
    // event the report exists to surface, so the record is kept whole and the
    // gap is reported instead of being smoothed away here.
    const tx = makeTx();

    const withdrawal = await recordProviderWithdrawal(
      makePrisma(tx) as never,
      validInput({ amount: 750_000, providerBalanceBefore: 1_200_000, providerBalanceAfter: 430_000 }),
    );

    expect(withdrawal.amount).toBe(750_000);
    expect(withdrawal.providerBalanceAfter).toBe(430_000);
  });

  it('writes the row and the journal in one transaction, so a failed post leaves no unposted record behind', async () => {
    const tx = makeTx();
    tx.ledgerEntry.createMany.mockRejectedValueOnce(new Error('disk is on fire'));

    await expect(recordProviderWithdrawal(makePrisma(tx) as never, validInput())).rejects.toThrow('disk is on fire');
    // The caller rolls the whole thing back, which is why the route wraps this
    // in a transaction rather than letting the row stand on its own.
    expect(tx.providerWithdrawal.create).toHaveBeenCalled();
  });
});

describe('reconcileProviderBalances', () => {
  /** A settlement at Sumopod, so the pot has something in it. */
  async function settleAt(tx: ReturnType<typeof makeTx>, provider: string, gross: number) {
    await tx.ledgerEntry.createMany({
      data: [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: gross, provider, providerWithdrawalId: null, transactionId: `w-${provider}-${gross}`, campaignId: 'c1', volunteerTripId: null, programId: null },
      ],
    });
  }

  it('reports nothing to reconcile when no sweep has ever been recorded, rather than reporting a zero divergence as a clean bill of health', async () => {
    // A provider pot with no reading is not a provider pot that has been
    // checked. Reporting `difference: 0` here would be the quietest possible
    // lie this module could tell, so the array is simply empty.
    const tx = makeTx();
    await settleAt(tx, 'sumopod', 1_000_000);

    expect(await reconcileProviderBalances(tx as never)).toEqual([]);
  });

  it('reports a zero divergence when the provider balance moved by exactly what was swept', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    await settleAt(tx, 'sumopod', 1_200_000);
    await recordProviderWithdrawal(prisma as never, validInput());

    const report = await reconcileProviderBalances(tx as never);

    expect(report).toEqual([
      {
        provider: 'sumopod',
        pot: { provider: 'sumopod', debited: 1_200_000, credited: 750_000, balance: 450_000 },
        withdrawn: 750_000,
        providerMovedBy: 750_000,
        difference: 0,
        withdrawals: [
          {
            withdrawalId: 'pw-1',
            provider: 'sumopod',
            reference: 'SP-2026-09-30-001',
            amount: 750_000,
            destinationName: 'Yayasan Sehat Mandiri',
            collectingEntityId: 'org-1',
            providerBalanceBefore: 1_200_000,
            providerBalanceAfter: 450_000,
            providerMovedBy: 750_000,
            difference: 0,
            recordedAt: '2026-09-30T00:00:00.000Z',
          },
        ],
      },
    ]);
  });

  it('reports the gap when the provider balance moved by more than we swept, and does not adjust anything', async () => {
    // The provider charged a fee on the transfer, or a chargeback landed in the
    // same window. The books said 750_000 left; the dashboard says 770_000 did.
    // The report says so, per sweep and in total, and writes nothing: correcting
    // a ledger from a human reading is how a difference disappears instead of
    // being explained.
    const tx = makeTx();
    const prisma = makePrisma(tx);
    await settleAt(tx, 'sumopod', 1_200_000);
    await recordProviderWithdrawal(prisma as never, validInput({ providerBalanceAfter: 430_000 }));

    const report = await reconcileProviderBalances(tx as never);

    expect(report[0].difference).toBe(20_000);
    expect(report[0].withdrawals[0].difference).toBe(20_000);
    // The pot is still the ledger's own figure: unreconciled, not corrected.
    expect(report[0].pot).toEqual({ provider: 'sumopod', debited: 1_200_000, credited: 750_000, balance: 450_000 });
    expect(ledgerRows.filter((r) => r.account === 'GATEWAY_CLEARING')).toHaveLength(2);
  });

  it('adds up the sweeps per provider, so one gap among many is visible rather than averaged away', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    await settleAt(tx, 'sumopod', 5_000_000);
    await recordProviderWithdrawal(prisma as never, validInput({ reference: 'SP-1', amount: 1_000_000, providerBalanceBefore: 5_000_000, providerBalanceAfter: 4_000_000 }));
    await recordProviderWithdrawal(prisma as never, validInput({ reference: 'SP-2', amount: 1_000_000, providerBalanceBefore: 4_000_000, providerBalanceAfter: 2_980_000 }));

    const report = await reconcileProviderBalances(tx as never);

    expect(report[0].withdrawn).toBe(2_000_000);
    expect(report[0].providerMovedBy).toBe(2_020_000);
    expect(report[0].difference).toBe(20_000);
    // Per sweep as well, so the second one is identifiable rather than the pair
    // being reported as one anonymous number.
    expect(report[0].withdrawals.map((w) => w.difference)).toEqual([0, 20_000]);
  });

  it('keeps the sweeps of each provider apart, and never nets one provider against another', async () => {
    // Two providers, one of which moved by more than it should. Reporting a
    // single combined difference would let a gap at Xendit be cancelled by an
    // exact match at Sumopod, and each provider's dashboard is a separate
    // statement.
    const tx = makeTx();
    const prisma = makePrisma(tx);
    await settleAt(tx, 'sumopod', 2_000_000);
    await settleAt(tx, 'xendit', 900_000);
    await recordProviderWithdrawal(prisma as never, validInput({ reference: 'SP-S', amount: 500_000, providerBalanceBefore: 2_000_000, providerBalanceAfter: 1_500_000 }));
    await recordProviderWithdrawal(prisma as never, validInput({ reference: 'SP-X', provider: 'xendit', amount: 400_000, providerBalanceBefore: 900_000, providerBalanceAfter: 460_000 }));

    const report = await reconcileProviderBalances(tx as never);

    expect(report.map((r) => [r.provider, r.difference])).toEqual([
      ['sumopod', 0],
      ['xendit', 40_000],
    ]);
  });

  it('never folds the unnamed Provider Balance movements into a named provider', async () => {
    // A completed Payout credits GATEWAY_CLEARING with no provider (payoutCompletedLegs
    // takes none, and nothing records one). Folding that credit into whichever
    // provider appears in a sweep would hand that provider a pot smaller than
    // the money actually left it, and the divergence would then read as the
    // provider's own discrepancy rather than as this ticket's known gap.
    const tx = makeTx();
    const prisma = makePrisma(tx);
    await settleAt(tx, 'sumopod', 1_200_000);
    await recordProviderWithdrawal(prisma as never, validInput());
    await tx.ledgerEntry.createMany({
      data: [
        { account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 120_000, provider: null, providerWithdrawalId: null, transactionId: 'payout-completed-payout-1', campaignId: null, volunteerTripId: null, programId: null },
      ],
    });

    const report = await reconcileProviderBalances(tx as never);

    // The sweep still reconciles exactly: the drain is not its discrepancy.
    expect(report[0].difference).toBe(0);
    // And the pot is the sum for that provider alone -- which is a floor, not
    // the whole Provider Balance, and the report's caller says so out loud.
    expect(report[0].pot).toEqual({ provider: 'sumopod', debited: 1_200_000, credited: 750_000, balance: 450_000 });
  });
});
