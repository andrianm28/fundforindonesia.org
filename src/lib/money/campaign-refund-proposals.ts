import { CampaignStatus, type Prisma, type PrismaClient, type Refund } from '@/generated/prisma/client';
import { effectiveStatus, lockAndLoad } from '@/lib/subject-guard';
import { campaignBalance, platformFeePortionFor, providerFeePortionFor } from './ledger';
import { CLOSED_CAMPAIGN_REFUND_REASON, createRefund, isRefundOrdinaryForKind } from './refunds';
import { STANDING_REFUND_WHERE } from './refund-standing';
import { currentSandboxStamp } from './sandbox-mode';
import {
  CampaignNotClosedForRefundProposalError,
  DemoCampaignError,
  DonationAnonymisedError,
  LateSettlementNotProposableError,
  PaymentNotFoundError,
  RefundAfterCampaignTransferError,
  RefundExceedsRemainingError,
  RefundNotAllowedForKindError,
} from './errors';

/**
 * Refund proposals for a closed Campaign (PRD 7.2, Pemicu; owner decision
 * 2026-10-16, "Sesuai PRD"; tickets audit-2026-10-16/07 and
 * rilis-1-benda/80).
 *
 * Nothing here is a new kind of Refund. A proposal is an ordinary REQUESTED
 * Refund made through `createRefund`, so the money is frozen at once and the
 * approval rules per Refund are untouched: the Admin who clicks is the
 * requester, a different Admin approves, a third completes. No system actor
 * exists, on purpose (REQ-12 keeps three distinct Admins).
 *
 * Two doors:
 *  - `proposeCampaignRefunds`: one click proposes a Refund for every Payment
 *    of a Suspended or Cancelled Campaign whose money has not left.
 *  - `lateSettlementWorklist` / `proposeLateSettlementRefund`: Donations that
 *    settled AFTER their Campaign closed (Suspended, Cancelled, Completed,
 *    Expired), as a list an Admin works one click at a time. The webhook is
 *    not involved, and ADR 0021 stands: a Payment paid after it EXPIRED on an
 *    open Campaign is a Settlement and is not listed.
 */

const BULK_STATUSES: CampaignStatus[] = [CampaignStatus.SUSPENDED, CampaignStatus.CANCELLED];

const CLOSED_STATUSES: CampaignStatus[] = [
  CampaignStatus.SUSPENDED,
  CampaignStatus.CANCELLED,
  CampaignStatus.COMPLETED,
  CampaignStatus.EXPIRED,
];

const STATUS_LABEL: Record<string, string> = {
  SUSPENDED: 'Ditangguhkan',
  CANCELLED: 'Dibatalkan',
  COMPLETED: 'Selesai',
  EXPIRED: 'Kedaluwarsa',
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * When each Campaign reached the status it is in now, from the audit log the
 * lifecycle module writes (CampaignStatusChange): the latest change whose
 * `toStatus` is that status. EXPIRED is also bounded by the deadline, because
 * the log records a lazy expiry whenever the first reader noticed it, which can
 * be long after the deadline passed; a Payment settled after the deadline but
 * before the log row must still count as late. A Campaign with no such row (and
 * no deadline for EXPIRED) has an unknown closure and is left out: with no
 * record, claiming a Payment came after it would be a guess about money.
 *
 * Limit: only the CURRENT closure is known. A Suspension that was lifted and
 * is no longer in force proposes nothing for money that arrived during it.
 */
async function closureTimes(
  db: Db,
  campaigns: Array<{ id: string; lifecycleStatus: CampaignStatus; deadline: Date | null }>,
  now: Date,
): Promise<Map<string, { status: CampaignStatus; closedAt: Date }>> {
  const result = new Map<string, { status: CampaignStatus; closedAt: Date }>();
  const withStatus = campaigns
    .map((c) => ({ ...c, status: effectiveStatus(c, now) }))
    .filter((c) => CLOSED_STATUSES.includes(c.status));
  if (withStatus.length === 0) return result;

  const changes = await db.campaignStatusChange.findMany({
    where: { campaignId: { in: withStatus.map((c) => c.id) }, toStatus: { in: CLOSED_STATUSES } },
    orderBy: { createdAt: 'desc' },
    select: { campaignId: true, toStatus: true, createdAt: true },
  });

  for (const c of withStatus) {
    const recorded = changes.find((ch) => ch.campaignId === c.id && ch.toStatus === c.status)?.createdAt ?? null;
    let closedAt = recorded;
    if (c.status === CampaignStatus.EXPIRED && c.deadline) {
      closedAt = recorded && recorded < c.deadline ? recorded : c.deadline;
    }
    if (closedAt) result.set(c.id, { status: c.status, closedAt });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Late settlements: the worklist.
// ---------------------------------------------------------------------------

/** The most rows the worklist shows at once; the oldest come first and the rest follow as these are worked. */
const WORKLIST_LIMIT = 200;

export type LateSettlementRow = {
  paymentId: string;
  amount: number;
  settledAt: Date;
  campaign: { id: string; slug: string; title: string; status: CampaignStatus; closedAt: Date };
};

/**
 * Confirmed Donation Payments that settled after their Campaign closed and
 * that have no Refund standing (REQUESTED, APPROVED, COMPLETED, ...; one that
 * ended REJECTED or FAILED stands for nothing, so the Payment returns to the
 * list). Same mode only (a sandbox Payment is never listed in live mode),
 * never an anonymised Donation or a Demo Campaign. `paymentId` narrows the
 * query to one Payment for the one-click action's own re-check.
 */
export async function lateSettlementWorklist(
  db: Db,
  opts: { paymentId?: string; now?: Date; limit?: number } = {},
): Promise<LateSettlementRow[]> {
  return (await lateSettlementWorklistPage(db, opts)).rows;
}

/** The worklist plus whether more rows exist beyond `limit` (the screen says so). */
export async function lateSettlementWorklistPage(
  db: Db,
  opts: { paymentId?: string; now?: Date; limit?: number } = {},
): Promise<{ rows: LateSettlementRow[]; truncated: boolean }> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? WORKLIST_LIMIT;

  // Closed Campaigns first (few), then only the Payments that settled after
  // each one's own closure, in SQL: a closed Campaign's earlier history is
  // never loaded.
  const campaigns = await db.campaign.findMany({
    where: {
      isDemo: false,
      ...(opts.paymentId ? { donations: { some: { payments: { some: { id: opts.paymentId } } } } } : {}),
      OR: [
        { lifecycleStatus: { in: CLOSED_STATUSES } },
        { lifecycleStatus: CampaignStatus.ACTIVE, deadline: { lt: now } },
      ],
    },
    select: { id: true, slug: true, title: true, lifecycleStatus: true, deadline: true },
  });
  const closures = await closureTimes(db, campaigns, now);
  if (closures.size === 0) return { rows: [], truncated: false };
  const byId = new Map(campaigns.map((c) => [c.id, c]));

  const payments = await db.payment.findMany({
    where: {
      ...(opts.paymentId ? { id: opts.paymentId } : {}),
      status: 'PAID',
      sandbox: currentSandboxStamp(),
      refunds: { none: STANDING_REFUND_WHERE },
      OR: [...closures].map(([campaignId, c]) => ({
        settledAt: { gt: c.closedAt },
        donation: { campaignId, anonymisedAt: null },
      })),
    },
    orderBy: { settledAt: 'asc' },
    take: limit + 1,
    select: { id: true, amount: true, settledAt: true, donation: { select: { campaignId: true } } },
  });

  const rows = payments.slice(0, limit).map((p) => {
    const campaign = byId.get(p.donation!.campaignId)!;
    const closure = closures.get(campaign.id)!;
    return {
      paymentId: p.id,
      amount: p.amount,
      settledAt: p.settledAt!,
      campaign: {
        id: campaign.id,
        slug: campaign.slug,
        title: campaign.title,
        status: closure.status,
        closedAt: closure.closedAt,
      },
    };
  });
  return { rows, truncated: payments.length > limit };
}

/**
 * One click on the worklist: a full-Gross Refund for one late Payment, the
 * calling Admin as requester. Re-checks the row under the Campaign lock, so a
 * stale list cannot propose twice (a second click finds the first Refund
 * standing, or is stopped by the cumulative cap in `createRefund`).
 */
export async function proposeLateSettlementRefund(
  prisma: PrismaClient,
  params: { paymentId: string; actorAdminId: string; now?: Date },
) {
  const { paymentId, actorAdminId, now = new Date() } = params;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { donation: { select: { campaignId: true } } },
  });
  if (!payment?.donation) throw new PaymentNotFoundError(paymentId);
  const campaignId = payment.donation.campaignId;

  return prisma.$transaction(async (tx) => {
    await lockAndLoad(tx, { type: 'campaign', campaignId }, now);
    const [row] = await lateSettlementWorklist(tx, { paymentId, now });
    if (!row) throw new LateSettlementNotProposableError();
    return createRefund(tx, {
      subject: { type: 'campaign', campaignId },
      paymentId,
      amount: row.amount,
      reason: CLOSED_CAMPAIGN_REFUND_REASON,
      requestedById: actorAdminId,
    });
  });
}

// ---------------------------------------------------------------------------
// The bulk proposal for a Suspended or Cancelled Campaign.
// ---------------------------------------------------------------------------

export type ProposalSkipReason =
  /** Its money left: the Campaign Balance cannot cover it any more. */
  | 'sudahKeluar'
  /** Wakaf, Hibah or Zakat, and the Payment came in before the closure: no allowed reason fits. */
  | 'kindTerbatas'
  /** Sandbox money in live mode, or the reverse. */
  | 'modeBerbeda'
  | 'anonim'
  /** Its money was moved to another Campaign by a Campaign Transfer. */
  | 'dipindahkan';

type TxOutcome = { skip: ProposalSkipReason } | { refund: Refund | 'already' | ProposalSkipReason };

export type ProposeCampaignRefundsResult = {
  created: Array<{ refundId: string; paymentId: string; amount: number }>;
  /** Payments that already have a Refund standing (also a race lost to another click). */
  alreadyProposed: number;
  skipped: Array<{ paymentId: string; amount: number; reason: ProposalSkipReason }>;
  /** The skipped Payments whose money has left: collected from the Fundraiser outside the system. */
  paidOut: { count: number; amount: number };
  /** Payments whose proposal failed for another reason; the run went on without them. */
  gagal: Array<{ paymentId: string; amount: number; error: string }>;
};

/**
 * One Admin action: propose a REQUESTED Refund, Gross, for every PAID Donation
 * Payment of a Suspended or Cancelled Campaign whose money has not left.
 *
 * "NOT LEFT", from the ledger. A Payout draws on the Campaign's pool, not on a
 * Payment, so nothing says which Payment's money went out. So:
 *  1. A Payment whose escrow has not been released sits in ESCROW_HOLD, which
 *     no Payout can touch: always proposed.
 *  2. A Payment whose escrow was released sits in the Campaign Balance. It is
 *     proposed only while that balance (already net of every Payout journalled
 *     and every Refund frozen so far, including the proposals this run has just
 *     made) covers its net freeze (Gross less its fee shares). Newest first,
 *     because a Payout drains the pool from the oldest money; whatever the
 *     balance cannot cover is reported as `sudahKeluar`, never forced.
 *
 * One transaction per Payment, each taking the Campaign lock first and
 * re-checking the status under it, so one Payment failing does not undo the
 * others and a lifted Suspension stops the run. Idempotent: a Payment with a
 * Refund standing is counted, not proposed again.
 */
export async function proposeCampaignRefunds(
  prisma: PrismaClient,
  params: { campaignId: string; actorAdminId: string; now?: Date },
): Promise<ProposeCampaignRefundsResult> {
  const { campaignId, actorAdminId, now = new Date() } = params;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, lifecycleStatus: true, deadline: true, isDemo: true },
  });
  if (!campaign || !BULK_STATUSES.includes(campaign.lifecycleStatus)) {
    throw new CampaignNotClosedForRefundProposalError();
  }
  if (campaign.isDemo) throw new DemoCampaignError();

  const closure = (await closureTimes(prisma, [campaign], now)).get(campaignId);
  const mode = currentSandboxStamp();

  const candidates = await prisma.payment.findMany({
    where: { status: 'PAID', donation: { campaignId } },
    select: {
      id: true,
      amount: true,
      sandbox: true,
      escrowReleasedAt: true,
      settledAt: true,
      createdAt: true,
      donation: { select: { anonymisedAt: true } },
      refunds: { where: STANDING_REFUND_WHERE, select: { id: true } },
    },
  });

  const result: ProposeCampaignRefundsResult = {
    created: [],
    alreadyProposed: 0,
    skipped: [],
    paidOut: { count: 0, amount: 0 },
    gagal: [],
  };
  const skip = (id: string, amount: number, reason: ProposalSkipReason) => {
    result.skipped.push({ paymentId: id, amount, reason });
    if (reason === 'sudahKeluar') {
      result.paidOut.count += 1;
      result.paidOut.amount += amount;
    }
  };

  const todo: typeof candidates = [];
  for (const p of candidates) {
    if (p.refunds.length > 0) result.alreadyProposed += 1;
    else if (p.sandbox !== mode) skip(p.id, p.amount, 'modeBerbeda');
    else if (p.donation?.anonymisedAt) skip(p.id, p.amount, 'anonim');
    else todo.push(p);
  }

  // Money still in escrow first (nothing can have taken it); then the rest,
  // newest first.
  const when = (p: (typeof todo)[number]) => (p.settledAt ?? p.createdAt).getTime();
  todo.sort((a, b) => {
    const aHeld = a.escrowReleasedAt == null ? 0 : 1;
    const bHeld = b.escrowReleasedAt == null ? 0 : 1;
    return aHeld - bHeld || when(b) - when(a);
  });

  for (const candidate of todo) {
    let outcome: TxOutcome;
    try {
      outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
        const state = await lockAndLoad(tx, { type: 'campaign', campaignId }, now);
        if (!state || state.kind !== 'campaign' || !BULK_STATUSES.includes(state.effectiveStatus)) {
          throw new CampaignNotClosedForRefundProposalError();
        }

        // The Payment lock, taken here (Campaign then Payment, the order
        // createRefund keeps), so escrowReleasedAt below cannot change under the
        // balance check.
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${candidate.id} FOR UPDATE`;
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: candidate.id },
          select: {
            status: true,
            amount: true,
            providerFee: true,
            platformFee: true,
            sandbox: true,
            escrowReleasedAt: true,
            settledAt: true,
          },
        });
        if (payment.status !== 'PAID') throw new LateSettlementNotProposableError();

        let reason = `Usulan penutupan Campaign: Campaign berstatus ${STATUS_LABEL[state.effectiveStatus]}`;
        if (!isRefundOrdinaryForKind(state.campaignKind)) {
          // Only money that really came in after the closure fits an allowed
          // phrase; anything else is reported, not given a phrase it does not fit.
          const late = closure && payment.settledAt && payment.settledAt > closure.closedAt;
          if (!late) return { skip: 'kindTerbatas' as const };
          reason = CLOSED_CAMPAIGN_REFUND_REASON;
        }

        if (payment.escrowReleasedAt != null) {
          const net =
            payment.amount -
            platformFeePortionFor(payment, payment.amount, []) -
            providerFeePortionFor(payment, payment.amount, []);
          const available = await campaignBalance(tx, campaignId, payment.sandbox);
          if (available < net) {
            // Money an APPROVED Campaign Transfer moved to another Campaign is
            // not "paid out to the Fundraiser": it still exists, elsewhere.
            // Attributed per Payment: only a transfer approved after this
            // Payment's money reached the Campaign Balance can have moved it.
            const movedOut = await tx.campaignTransfer.count({
              where: {
                sourceId: campaignId,
                status: 'APPROVED',
                decidedAt: { gte: payment.escrowReleasedAt },
              },
            });
            return { skip: movedOut > 0 ? ('dipindahkan' as const) : ('sudahKeluar' as const) };
          }
        }

        const refund = await createRefund(tx, {
          subject: { type: 'campaign', campaignId },
          paymentId: candidate.id,
          amount: payment.amount,
          reason,
          requestedById: actorAdminId,
        }).catch((err: unknown) => {
          if (err instanceof RefundExceedsRemainingError) return 'already' as const;
          if (err instanceof DonationAnonymisedError) return 'anonim' as const;
          if (err instanceof RefundAfterCampaignTransferError) return 'dipindahkan' as const;
          if (err instanceof RefundNotAllowedForKindError) return 'kindTerbatas' as const;
          throw err;
        });
        return { refund };
      });
    } catch (err) {
      // The Campaign stopped being closed: every later Payment would fail the
      // same way, so the run stops. Anything else is this Payment's alone.
      if (err instanceof CampaignNotClosedForRefundProposalError) throw err;
      const known = err instanceof Error && 'code' in err;
      if (!known) console.error('[proposeCampaignRefunds] unexpected failure', candidate.id, err);
      result.gagal.push({
        paymentId: candidate.id,
        amount: candidate.amount,
        error: known ? (err as Error).message : 'Gagal tidak terduga.',
      });
      continue;
    }

    if ('skip' in outcome) skip(candidate.id, candidate.amount, outcome.skip);
    else if (outcome.refund === 'already') result.alreadyProposed += 1;
    else if (typeof outcome.refund === 'string') skip(candidate.id, candidate.amount, outcome.refund);
    else result.created.push({ refundId: outcome.refund.id, paymentId: candidate.id, amount: outcome.refund.amount });
  }

  return result;
}
