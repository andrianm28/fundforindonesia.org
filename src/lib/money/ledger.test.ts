import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  postTransaction,
  campaignBalance,
  escrowBalance,
  findUnbalancedTransactions,
  paymentSettledLegs,
  escrowReleaseLegs,
  refundLegs,
  payoutInstructedLegs,
  UnbalancedTransactionError,
  InvalidLedgerLegError,
  type LedgerLeg,
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

  it('is idempotent on transactionId, so a webhook retry posts once', async () => {
    await postTransaction(tx as never, BALANCED, { transactionId: 'evt-1' });
    await postTransaction(tx as never, BALANCED, { transactionId: 'evt-1' });
    expect(tx.rows).toHaveLength(2);
  });
});

describe('balances', () => {
  it('separates held money from withdrawable money, per campaign', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, paymentSettledLegs({ campaignId: 'c1', grossAmount: 100_000, providerFee: 3_000 }));
    await postTransaction(tx as never, paymentSettledLegs({ campaignId: 'c2', grossAmount: 50_000, providerFee: 0 }));

    // Settled, but inside the window: visible as escrow, withdrawable as zero.
    expect(await escrowBalance(tx as never, 'c1')).toBe(97_000);
    expect(await campaignBalance(tx as never, 'c1')).toBe(0);

    await postTransaction(tx as never, escrowReleaseLegs({ campaignId: 'c1', amount: 97_000 }));
    expect(await escrowBalance(tx as never, 'c1')).toBe(0);
    expect(await campaignBalance(tx as never, 'c1')).toBe(97_000);

    await postTransaction(tx as never, payoutInstructedLegs({ campaignId: 'c1', amount: 40_000 }));
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
    const legs = paymentSettledLegs({ campaignId: 'c1', grossAmount: 100_000, providerFee: 2_500 });
    // Crediting gross is how a campaign becomes able to withdraw money that
    // never arrived.
    expect(legs.find((l) => l.account === 'ESCROW_HOLD')?.amount).toBe(97_500);
    expect(legs.find((l) => l.account === 'PROVIDER_FEE')?.amount).toBe(2_500);
  });

  it('settles into escrow, never straight into the withdrawable balance', () => {
    // The whole point of the hold. If this ever regresses, money becomes
    // payable the instant it settles and the dispute window is gone.
    const legs = paymentSettledLegs({ campaignId: 'c1', grossAmount: 100_000, providerFee: 0 });
    expect(legs.some((l) => l.account === 'CAMPAIGN_BALANCE')).toBe(false);
    expect(legs.some((l) => l.account === 'ESCROW_HOLD')).toBe(true);
  });

  it('omits the fee leg entirely when the fee is zero', () => {
    const legs = paymentSettledLegs({ campaignId: 'c1', grossAmount: 100_000, providerFee: 0 });
    expect(legs.some((l) => l.account === 'PROVIDER_FEE')).toBe(false);
    expect(legs).toHaveLength(2);
  });

  it('rejects a fee larger than the payment, or negative', () => {
    expect(() => paymentSettledLegs({ campaignId: 'c1', grossAmount: 1_000, providerFee: 1_001 })).toThrow();
    expect(() => paymentSettledLegs({ campaignId: 'c1', grossAmount: 1_000, providerFee: -1 })).toThrow();
  });
});

describe('refundLegs', () => {
  it('debits escrow when refunding inside the hold window', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, paymentSettledLegs({ campaignId: 'c1', grossAmount: 100_000, providerFee: 0 }));
    await postTransaction(
      tx as never,
      refundLegs({ campaignId: 'c1', amount: 30_000, source: 'ESCROW_HOLD', creditedAmount: 100_000 }),
    );

    expect(await escrowBalance(tx as never, 'c1')).toBe(70_000);
    // Never negative: the money came out of the pot it was actually sitting in.
    expect(await campaignBalance(tx as never, 'c1')).toBe(0);
  });

  it('debits the withdrawable balance when refunding after release', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, paymentSettledLegs({ campaignId: 'c1', grossAmount: 100_000, providerFee: 0 }));
    await postTransaction(tx as never, escrowReleaseLegs({ campaignId: 'c1', amount: 100_000 }));
    await postTransaction(
      tx as never,
      refundLegs({ campaignId: 'c1', amount: 30_000, source: 'CAMPAIGN_BALANCE', creditedAmount: 100_000 }),
    );

    expect(await escrowBalance(tx as never, 'c1')).toBe(0);
    expect(await campaignBalance(tx as never, 'c1')).toBe(70_000);
  });

  it('rejects a refund larger than what the payment actually credited', () => {
    // A payment of gross 100_000 with a 15_000 provider fee only ever credited
    // 85_000 (the NET) to ESCROW_HOLD. Refunding the gross would debit
    // ESCROW_HOLD by 100_000 -- 15_000 more than it was ever credited.
    expect(() =>
      refundLegs({ campaignId: 'c1', amount: 100_000, source: 'ESCROW_HOLD', creditedAmount: 85_000 }),
    ).toThrow(InvalidLedgerLegError);
  });

  it('allows a refund of exactly what was credited', () => {
    expect(() =>
      refundLegs({ campaignId: 'c1', amount: 85_000, source: 'ESCROW_HOLD', creditedAmount: 85_000 }),
    ).not.toThrow();
  });
});

describe('ledger invariants (property-based)', () => {
  it('every builder produces a transaction that balances, for any amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (gross, feeRaw) => {
          const fee = Math.min(feeRaw, gross);
          for (const legs of [
            paymentSettledLegs({ campaignId: 'c1', grossAmount: gross, providerFee: fee }),
            escrowReleaseLegs({ campaignId: 'c1', amount: gross }),
            refundLegs({ campaignId: 'c1', amount: gross, source: 'ESCROW_HOLD', creditedAmount: gross }),
            refundLegs({ campaignId: 'c1', amount: gross, source: 'CAMPAIGN_BALANCE', creditedAmount: gross }),
            payoutInstructedLegs({ campaignId: 'c1', amount: gross }),
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
        paymentSettledLegs({ campaignId: 'c1', grossAmount: 10_000 + i, providerFee: i }),
      );
      await postTransaction(tx as never, escrowReleaseLegs({ campaignId: 'c1', amount: 10_000 }));
      if (i % 3 === 0) {
        await postTransaction(tx as never, payoutInstructedLegs({ campaignId: 'c1', amount: 1_000 }));
      }
    }
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });

  it('the full lifecycle lands on the arithmetic everyone expects', async () => {
    const tx = makeTx();
    // Rp 500.000 donated, Rp 15.000 kept by the provider.
    await postTransaction(tx as never, paymentSettledLegs({ campaignId: 'c1', grossAmount: 500_000, providerFee: 15_000 }));
    // Rp 100.000 refunded while still held (well within the 485.000 net credited).
    await postTransaction(
      tx as never,
      refundLegs({ campaignId: 'c1', amount: 100_000, source: 'ESCROW_HOLD', creditedAmount: 485_000 }),
    );
    // The rest matures.
    await postTransaction(tx as never, escrowReleaseLegs({ campaignId: 'c1', amount: 385_000 }));
    // Rp 200.000 paid out.
    await postTransaction(tx as never, payoutInstructedLegs({ campaignId: 'c1', amount: 200_000 }));

    expect(await escrowBalance(tx as never, 'c1')).toBe(0);
    expect(await campaignBalance(tx as never, 'c1')).toBe(485_000 - 100_000 - 200_000);
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });
});
