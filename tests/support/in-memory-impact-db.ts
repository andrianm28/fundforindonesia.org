import {
  collectionAccountWithdrawalLegs,
  escrowReleaseLegs,
  manualContributionReceivedLegs,
  manualContributionReversedLegs,
  paymentSettledLegs,
  payoutInstructedLegs,
  refundApprovedLegs,
  refundPaidLegs,
  refundRequestedLegs,
  type LedgerLeg,
  type LedgerSubject,
  type ManualContributionSubject,
} from '@/lib/money/ledger';

/**
 * In-memory stand-in for the slice of PrismaClient the Impact breakdown reads
 * (src/lib/money/impact.ts), in the style of the other in-memory dbs in this
 * directory: the real reader runs against it, and tests assert on the
 * breakdown it returns rather than on which queries it issued.
 *
 * The ledger rows are built with the REAL leg builders (paymentSettledLegs,
 * refundRequestedLegs, ...) rather than hand-written, so a fixture is
 * exactly the shape the money layer posts -- a test cannot accidentally
 * describe a movement the ledger would refuse to write. Expected amounts in
 * the tests are worked literals from the PRD (FFI-14), never recomputed by
 * the code under test.
 */

export type CampaignRow = {
  id: string;
  title?: string;
  isDemo?: boolean;
  location?: string | null;
};

export type PaymentRow = {
  id: string;
  /** Set for a Donation-backed Payment; null for a Trip Fee Payment. */
  campaignId?: string | null;
  status?: string;
};

export type RefundRow = { id: string; paymentId: string };

export type PayoutRow = {
  id: string;
  campaignId?: string | null;
  amount: number;
  status: string;
};

export type LedgerRow = {
  transactionId: string;
  account: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  campaignId: string | null;
  volunteerTripId: string | null;
  programId: string | null;
  paymentId: string | null;
  refundId: string | null;
  payoutId: string | null;
  manualContributionId: string | null;
  providerWithdrawalId: string | null;
};

type Row = Record<string, unknown>;

function comparable(value: unknown): number | string {
  return value instanceof Date ? value.getTime() : (value as number | string);
}

/**
 * The Prisma filter shapes the Impact reader uses: plain equality (null
 * included), `in`, `not: null`, `contains` with `mode: 'insensitive'`, and
 * one level of nested relation filter (Payment.donation.campaignId). Anything
 * else throws, so the reader never silently matches more than Postgres would.
 */
function matchesField(actual: unknown, filter: unknown): boolean {
  if (filter === null || typeof filter !== 'object' || filter instanceof Date) {
    return actual === filter || comparable(actual) === comparable(filter);
  }
  const { mode, ...ops } = filter as Row;
  return Object.entries(ops).every(([op, operand]) => {
    if (operand === undefined) return true;
    switch (op) {
      case 'equals':
        return matchesField(actual, operand);
      case 'in':
        return (operand as unknown[]).includes(actual);
      case 'not':
        return actual !== operand;
      case 'contains':
        return (
          typeof actual === 'string' &&
          (mode === 'insensitive'
            ? actual.toLowerCase().includes(String(operand).toLowerCase())
            : actual.includes(String(operand)))
        );
      default:
        throw new Error(`in-memory impact db does not understand the filter ${op}`);
    }
  });
}

function matches(row: Row, where: Row | undefined, resolve: (key: string) => unknown): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, filter]) => {
    const value = resolve(key);
    if (value !== undefined && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return matches(value as Row, filter as Row, resolve);
    }
    return matchesField(value, filter);
  });
}

export type ImpactDbData = {
  campaigns: CampaignRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  payouts: PayoutRow[];
  ledgerEntries: LedgerRow[];
};

/**
 * The ledger a test feeds in, built from the real leg builders so every
 * transaction is one the money layer would actually post.
 */
export function ledgerFixture() {
  const rows: LedgerRow[] = [];
  let sequence = 0;

  const post = (
    legs: LedgerLeg[],
    refs: Partial<
      Pick<LedgerRow, 'paymentId' | 'refundId' | 'payoutId' | 'manualContributionId' | 'providerWithdrawalId'>
    >,
  ) => {
    const transactionId = `tx-${++sequence}`;
    for (const leg of legs) {
      rows.push({
        transactionId,
        account: leg.account,
        direction: leg.direction,
        amount: leg.amount,
        campaignId: leg.campaignId ?? null,
        volunteerTripId: leg.volunteerTripId ?? null,
        programId: leg.programId ?? null,
        paymentId: refs.paymentId ?? null,
        refundId: refs.refundId ?? null,
        payoutId: refs.payoutId ?? null,
        manualContributionId: refs.manualContributionId ?? null,
        providerWithdrawalId: refs.providerWithdrawalId ?? null,
      });
    }
  };

  const subject = (campaignId: string): LedgerSubject => ({ type: 'campaign', campaignId });

  // The Manual Contribution builders take the narrower ManualContributionSubject
  // rather than LedgerSubject, so they cannot be handed a trip by accident --
  // the same separation the production code keeps.
  const manualSubject = (campaignId: string): ManualContributionSubject => ({ type: 'campaign', campaignId });

  return {
    rows,
    /** A Donation Settling at the provider (CONTEXT.md, Settlement). */
    settle(opts: {
      paymentId: string;
      campaignId: string;
      gross: number;
      providerFee: number;
      platformFee?: number;
    }) {
      post(
        paymentSettledLegs({
          subject: subject(opts.campaignId),
          grossAmount: opts.gross,
          providerFee: opts.providerFee,
          platformFee: opts.platformFee ?? 0,
        }),
        { paymentId: opts.paymentId },
      );
    },
    /** An Escrow Hold maturing into the withdrawable balance. */
    release(opts: { paymentId: string; campaignId: string; amount: number }) {
      post(escrowReleaseLegs({ subject: subject(opts.campaignId), amount: opts.amount }), {
        paymentId: opts.paymentId,
      });
    },
    /** A Refund freezing the Donor money the moment it is created. */
    refundRequest(opts: {
      refundId: string;
      campaignId: string;
      amount: number;
      source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE';
      platformFeePortion: number;
      providerFeePortion: number;
    }) {
      post(
        refundRequestedLegs({
          subject: subject(opts.campaignId),
          amount: opts.amount,
          source: opts.source,
          platformFeePortion: opts.platformFeePortion,
          providerFeePortion: opts.providerFeePortion,
        }),
        { refundId: opts.refundId },
      );
    },
    /** The gross going back to the Donor, plus any shortfall the Campaign cannot cover. */
    refundApproval(opts: {
      refundId: string;
      campaignId: string;
      amount: number;
      source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE';
      shortfall: number;
    }) {
      post(
        refundApprovedLegs({
          subject: subject(opts.campaignId),
          amount: opts.amount,
          source: opts.source,
          shortfall: opts.shortfall,
        }),
        { refundId: opts.refundId },
      );
    },
    /** The Refund actually paid to the Donor, which is what drains the Provider Balance. */
    refundPayment(opts: { refundId: string; amount: number }) {
      post(refundPaidLegs({ amount: opts.amount }), { refundId: opts.refundId });
    },
    /** A Payout instructed out of the Campaign Balance. */
    payoutInstruction(opts: { payoutId: string; campaignId: string; amount: number }) {
      post(payoutInstructedLegs({ subject: subject(opts.campaignId), amount: opts.amount }), {
        payoutId: opts.payoutId,
      });
    },
    /** An arbitrary balanced pair, for fixtures the builders above cannot express. */
    raw(
      legs: LedgerLeg[],
      refs: Partial<Pick<LedgerRow, 'paymentId' | 'refundId' | 'payoutId' | 'manualContributionId'>> = {},
    ) {
      post(legs, refs);
    },
    /**
     * A withdrawal from the Provider Balance to the Collection Account
     * (prd-compliance 35), posted with the real leg builder so the fixture is
     * exactly the shape the money layer writes.
     *
     * On the Impact page this movement must change nothing at all, and that is
     * worth a fixture rather than a `raw()` call: both legs are platform-level
     * and carry no Payment, Refund, Payout or Campaign, so none of the six
     * lines has anything to read them from. If a future version of this
     * movement ever acquired one of those, the conservation assertion in
     * impact.ts would start throwing and this fixture is what would show it.
     */
    providerSweep(opts: { providerWithdrawalId: string; amount: number }) {
      post(collectionAccountWithdrawalLegs({ amount: opts.amount }), {
        providerWithdrawalId: opts.providerWithdrawalId,
      });
    },
    /** Money an Admin recorded as arriving outside the gateway, into a Campaign. */    manualContribution(opts: { manualContributionId: string; campaignId: string; amount: number }) {
      post(
        manualContributionReceivedLegs({
          subject: manualSubject(opts.campaignId),
          amount: opts.amount,
        }),
        { manualContributionId: opts.manualContributionId },
      );
    },
    /** The same money taken back out again, on a new transaction. */
    manualContributionReversal(opts: { manualContributionId: string; campaignId: string; amount: number }) {
      post(
        manualContributionReversedLegs({
          subject: manualSubject(opts.campaignId),
          amount: opts.amount,
        }),
        { manualContributionId: opts.manualContributionId },
      );
    },
  };
}

export function makeImpactDb(overrides: Partial<ImpactDbData> = {}) {
  const data: ImpactDbData = {
    campaigns: [],
    payments: [],
    refunds: [],
    payouts: [],
    ledgerEntries: [],
    ...overrides,
  };

  // A Payment is matched through its Donation, as Prisma matches it: the
  // fixture names the Campaign and the reader asks for
  // `donation: { campaignId: { in: [...] } }`.
  const paymentRow = (row: PaymentRow): Row => ({
    ...row,
    donationId: row.campaignId == null ? null : `donation-of-${row.id}`,
    donation: row.campaignId == null ? null : { campaignId: row.campaignId },
  });

  const tx = {
    campaign: {
      findMany: async (args: { where?: Row } = {}) =>
        // isDemo defaults to false exactly as the column does, so a fixture
        // that never mentions it is a real Campaign rather than a row whose
        // `isDemo: false` predicate silently matches nothing.
        data.campaigns
          .map((c) => ({ ...c, isDemo: c.isDemo ?? false, location: c.location ?? null }))
          .filter((c) => matches(c as Row, args.where, (key) => (c as Row)[key])),
    },
    payment: {
      findMany: async (args: { where?: Row } = {}) => {
        const resolved = data.payments.map(paymentRow);
        return resolved.filter((p) =>
          matches(p, args.where, (key) => {
            if (key === 'donation') return p.donation;
            return p[key];
          }),
        );
      },
    },
    refund: {
      findMany: async (args: { where?: Row } = {}) =>
        data.refunds.filter((r) => matches(r as Row, args.where, (key) => (r as Row)[key])),
    },
    payout: {
      findMany: async (args: { where?: Row } = {}) =>
        data.payouts.filter((p) => matches(p as Row, args.where, (key) => (p as Row)[key])),
    },
    ledgerEntry: {
      groupBy: async (args: { by: string[]; where?: Row; _sum: { amount: true } }) => {
        const filtered = data.ledgerEntries.filter((e) =>
          matches(e as Row, args.where, (key) => (e as Row)[key]),
        );
        const buckets = new Map<string, { row: Row; sum: number }>();
        for (const entry of filtered) {
          const key = args.by.map((k) => String((entry as Row)[k])).join('|');
          const bucket = buckets.get(key) ?? {
            row: Object.fromEntries(args.by.map((k) => [k, (entry as Row)[k]])),
            sum: 0,
          };
          bucket.sum += entry.amount;
          buckets.set(key, bucket);
        }
        return Array.from(buckets.values()).map((b) => ({ ...b.row, _sum: { amount: b.sum } }));
      },
    },
  };

  return {
    prisma: {
      ...tx,
      $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    },
    data,
  };
}
