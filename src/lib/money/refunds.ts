import type { Payment, Prisma, PrismaClient, Refund } from '@/generated/prisma/client';
import { OwnCampaignConflictError } from '@/lib/campaign-lifecycle';
import { lockAndLoad, OwnTripConflictError, requireNotOwnerAsAdmin } from '@/lib/subject-guard';
import {
  campaignBalance,
  tripBalance,
  escrowBalance,
  tripEscrowBalance,
  postTransaction,
  refundRequestedLegs,
  refundApprovedLegs,
  providerFeePortionFor,
  type LedgerSubject,
} from './ledger';
import {
  DemoCampaignError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
  RefundNotFoundError,
  SelfApprovalError,
  InvalidRefundStatusError,
} from './errors';

/**
 * Refund: request, approve.
 *
 * Ported from the same two-person disbursement discipline as
 * src/lib/money/payouts.ts, generalized over subject: LedgerSubject from
 * day one (see the spec's own User Story 11) rather than forked into a
 * Trip-scoped sibling later.
 *
 * This ticket's own code only ever produces REQUESTED and APPROVED --
 * AWAITING_DONOR_DETAILS, PROCESSING, COMPLETED, REJECTED, FAILED stay in
 * the schema's enum for the donor-facing flow and the reject/cancel path,
 * neither of which this ticket builds a route for.
 */

export {
  DemoCampaignError,
  OwnCampaignConflictError,
  OwnTripConflictError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
  RefundNotFoundError,
  SelfApprovalError,
  InvalidRefundStatusError,
};

type PaymentWithSubjectLinks = Pick<Payment, 'amount' | 'providerFee' | 'escrowReleasedAt'> & {
  donation: { campaignId: string } | null;
  registration: { batch: { tripId: string } } | null;
};

/**
 * Which Campaign-or-Trip a Payment belongs to, read off whichever of
 * donation/registration is actually set -- the same derivation
 * src/lib/money/escrow.ts already uses for the identical purpose.
 */
function paymentSubjectOf(payment: PaymentWithSubjectLinks): LedgerSubject {
  return payment.donation
    ? { type: 'campaign', campaignId: payment.donation.campaignId }
    : { type: 'trip', tripId: payment.registration!.batch.tripId };
}

function sameSubject(a: LedgerSubject, b: LedgerSubject): boolean {
  if (a.type !== b.type) return false;
  return a.type === 'campaign'
    ? a.campaignId === (b as { campaignId: string }).campaignId
    : a.tripId === (b as { tripId: string }).tripId;
}

/**
 * ESCROW_HOLD while the Payment's escrow hasn't matured, the subject's
 * withdrawable balance once it has. Re-derived fresh at both createRefund
 * and approveRefund time -- escrow can mature in the window between the
 * two, and each call cares about where the pool sits right now, not where
 * it sat when the other call ran.
 */
function sourceFor(
  payment: Pick<Payment, 'escrowReleasedAt'>,
  subject: LedgerSubject,
): 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE' {
  if (payment.escrowReleasedAt == null) return 'ESCROW_HOLD';
  return subject.type === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE';
}

async function poolBalanceFor(
  tx: Prisma.TransactionClient,
  subject: LedgerSubject,
  source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE',
): Promise<number> {
  if (source === 'ESCROW_HOLD') {
    return subject.type === 'campaign' ? escrowBalance(tx, subject.campaignId) : tripEscrowBalance(tx, subject.tripId);
  }
  return subject.type === 'campaign' ? campaignBalance(tx, subject.campaignId) : tripBalance(tx, subject.tripId);
}

/**
 * An Admin creates a Refund for a Payment. Locks the subject (Campaign or
 * VolunteerTrip) BEFORE the Payment row, matching the Campaign/VolunteerTrip
 * -> Payment order this codebase's other money-moving transactions already
 * use (releaseMaturedEscrow, approvePayout) -- locking Payment first here
 * would reintroduce the deadlock class that ordering exists to prevent, if
 * this ever races the escrow sweep on the same matured-but-not-yet-released
 * Payment. The Payment lock itself is still what makes the cumulative-
 * refund-cap check below safe: two concurrent createRefund calls against
 * two DIFFERENT Payments on the same Campaign do not contend on it at all,
 * but two against the SAME Payment must not both read the same
 * prior-refunds sum and both pass the cap before either commits.
 *
 * Unlike requestPayout (which posts nothing at request time), this
 * immediately posts the freeze in the same transaction -- the PRD's
 * "seketika" requirement: a Campaign or Trip must not be able to spend
 * money that is already earmarked for return. The Provider Fee (and
 * Platform Fee) portion is split out right here, at freeze time -- see
 * refundRequestedLegs (./ledger.ts) for why deferring it to settlement was
 * wrong.
 */
export async function createRefund(
  tx: Prisma.TransactionClient,
  params: {
    subject: LedgerSubject;
    paymentId: string;
    amount: number;
    reason: string;
    requestedById: string;
  },
): Promise<Refund> {
  const { subject, paymentId, amount, reason, requestedById } = params;

  const subjectState = await lockAndLoad(tx, subject, new Date());

  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  if (lockedRows.length === 0) {
    throw new PaymentNotFoundError(paymentId);
  }

  const payment = (await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { donation: true, registration: { include: { batch: true } } },
  })) as unknown as PaymentWithSubjectLinks & { id: string };

  const paymentSubject = paymentSubjectOf(payment);
  if (!sameSubject(subject, paymentSubject)) {
    throw new PaymentSubjectMismatchError(paymentId);
  }

  if (subjectState?.kind === 'campaign') {
    if (subjectState.isDemo) {
      throw new DemoCampaignError();
    }
    // Only Campaign subjects: every Trip-subject caller creates the Refund
    // as the Trip's Fundraiser (Batch cancellation), the Volunteer, or the
    // settlement webhook -- never in an Admin capacity.
    requireNotOwnerAsAdmin(subjectState, requestedById);
  }

  const priorRefunds = await tx.refund.findMany({
    where: { paymentId, status: { notIn: ['REJECTED', 'FAILED'] } },
    orderBy: { createdAt: 'asc' },
    select: { amount: true, status: true },
  });
  const priorAmounts = priorRefunds
    .filter((r: { status: string }) => r.status !== 'REJECTED' && r.status !== 'FAILED')
    .map((r: { amount: number }) => r.amount);
  const alreadyCommitted = priorAmounts.reduce((sum: number, a: number) => sum + a, 0);
  const remaining = payment.amount - alreadyCommitted;
  if (amount > remaining) {
    throw new RefundExceedsRemainingError(amount, remaining);
  }

  const refund = await tx.refund.create({
    data: { paymentId, amount, reason, requestedById, status: 'REQUESTED' },
  });

  const source = sourceFor(payment, subject);
  const platformFeePortion = 0; // no field to derive from -- see the comment on this in approveRefund
  const providerFeePortion = providerFeePortionFor(payment, amount, priorAmounts);
  await postTransaction(
    tx,
    refundRequestedLegs({ subject, amount, source, platformFeePortion, providerFeePortion }),
    { refundId: refund.id, transactionId: `refund-requested-${refund.id}` },
  );

  return refund;
}

/**
 * A different Admin approves a REQUESTED Refund: posts the gross-
 * recognition settlement and lands on APPROVED. See refundApprovedLegs
 * (./ledger.ts) for the exact debit/credit math -- it closes FROZEN_BALANCE
 * in full and, only for a genuine shortfall (the fee was already handled
 * at freeze time, never here), tops the pool back up.
 */
export async function approveRefund(
  prisma: PrismaClient,
  params: { refundId: string; approvedById: string },
): Promise<Refund> {
  const { refundId, approvedById } = params;

  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: { include: { donation: true, registration: { include: { batch: true } } } },
      },
    });
    if (!refund) {
      throw new RefundNotFoundError(refundId);
    }

    if (refund.requestedById === approvedById) {
      throw new SelfApprovalError('Refund');
    }

    const payment = refund.payment as unknown as PaymentWithSubjectLinks;
    const subject = paymentSubjectOf(payment);

    // Locks the subject, not the Refund row: the contended resource for the
    // shortfall computation below is the subject's pool, and a second,
    // different Refund against the same subject approved concurrently must
    // be serialised here, exactly mirroring approvePayout's own Campaign/
    // VolunteerTrip lock. Its owner is read under that lock, not before it.
    const subjectState = await lockAndLoad(tx, subject, new Date());

    // Approval is always an Admin act, so it is refused to the Campaign's
    // or the Trip's own Fundraiser.
    if (subjectState) requireNotOwnerAsAdmin(subjectState, approvedById);

    if (refund.status !== 'REQUESTED') {
      throw new InvalidRefundStatusError(refund.status);
    }

    const source = sourceFor(payment, subject);
    const poolBalance = await poolBalanceFor(tx, subject, source);

    // Recompute this refund's own fee portion exactly the way createRefund
    // did at freeze time -- deterministic from stable inputs (Payment
    // fields never change; every OTHER non-REJECTED/FAILED refund on this
    // Payment created before this one is a fixed, immutable fact), so it
    // reproduces the exact number already posted at freeze time.
    const priorRefunds = await tx.refund.findMany({
      where: { paymentId: refund.paymentId, status: { notIn: ['REJECTED', 'FAILED'] }, createdAt: { lt: refund.createdAt } },
      orderBy: { createdAt: 'asc' },
      select: { amount: true },
    });
    // Platform Fee is never charged anywhere in this codebase today -- no
    // Payment/Campaign field stores one, so there is nothing to multiply by
    // amount / payment.amount. Hardcoded, not derived, until such a field
    // exists.
    const platformFeePortion = 0;
    const providerFeePortion = providerFeePortionFor(
      payment,
      refund.amount,
      priorRefunds.map((r: { amount: number }) => r.amount),
    );
    const netPortion = refund.amount - platformFeePortion - providerFeePortion;
    // The pool was never over-drawn by this refund's own fee (that was
    // already removed correctly at freeze time) -- a negative reading here
    // is genuine insolvency (e.g. a Payout already spent the pool below
    // this refund's net share), never a fee artifact.
    const shortfall = Math.min(Math.max(0, -poolBalance), netPortion);

    const claimed = await tx.refund.updateMany({
      where: { id: refundId, status: 'REQUESTED' },
      data: { status: 'APPROVED', approvedById },
    });
    if (claimed.count === 0) {
      throw new InvalidRefundStatusError('unknown (changed concurrently)', 'lost the approval race');
    }

    await postTransaction(
      tx,
      refundApprovedLegs({ subject, amount: refund.amount, source, shortfall }),
      { refundId: refund.id, transactionId: `refund-approved-${refund.id}` },
    );
  });

  return prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
}
