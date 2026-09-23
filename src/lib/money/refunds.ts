import type { Payment, Prisma, PrismaClient, Refund } from '@/generated/prisma/client';
import {
  campaignBalance,
  tripBalance,
  escrowBalance,
  tripEscrowBalance,
  postTransaction,
  refundRequestedLegs,
  refundApprovedLegs,
  type LedgerSubject,
} from './ledger';
import { DemoCampaignError } from './payouts';

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

export { DemoCampaignError };

export class PaymentNotFoundError extends Error {
  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} not found.`);
    this.name = 'PaymentNotFoundError';
  }
}

export class PaymentSubjectMismatchError extends Error {
  constructor(readonly paymentId: string) {
    super(
      `Payment ${paymentId} does not belong to the given subject -- a Campaign-linked Payment ` +
        'was refunded against a Trip subject, a Trip-linked one against a Campaign subject, or ' +
        'against the wrong Campaign/Trip entirely.',
    );
    this.name = 'PaymentSubjectMismatchError';
  }
}

export class RefundExceedsRemainingError extends Error {
  constructor(
    readonly requested: number,
    readonly remaining: number,
  ) {
    super(
      `Requested refund of ${requested} exceeds the ${remaining} still refundable on this Payment ` +
        '(its Gross minus every prior Refund that is not REJECTED or FAILED -- REQUESTED refunds ' +
        'count too, since their funds are already frozen).',
    );
    this.name = 'RefundExceedsRemainingError';
  }
}

export class RefundNotFoundError extends Error {
  constructor(readonly refundId: string) {
    super(`Refund ${refundId} not found.`);
    this.name = 'RefundNotFoundError';
  }
}

export class SelfApprovalError extends Error {
  constructor() {
    super(
      'approvedById equals requestedById. The two-person rule is this equality check and ' +
        'nothing else -- refused before any write, not recorded as a decision.',
    );
    this.name = 'SelfApprovalError';
  }
}

export class InvalidRefundStatusError extends Error {
  constructor(
    readonly currentStatus: string,
    detail?: string,
  ) {
    super(`Refund status is ${currentStatus}; this transition is not allowed.${detail ? ` (${detail})` : ''}`);
    this.name = 'InvalidRefundStatusError';
  }
}

/** Integer-safe ceiling division -- every proportional fee split rounds up, never down. */
function ceilDiv(numerator: number, denominator: number): number {
  return Math.ceil(numerator / denominator);
}

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
 * An Admin creates a Refund for a Payment. Locks the Payment row first --
 * the contended resource for the cumulative-refund-cap check below is this
 * Payment's own remaining refundable amount, not the subject's aggregate
 * balance, so two concurrent createRefund calls against two DIFFERENT
 * Payments on the same Campaign do not contend here at all, but two against
 * the SAME Payment must not both read the same prior-refunds sum and both
 * pass the cap before either commits.
 *
 * Unlike requestPayout (which posts nothing at request time), this
 * immediately posts a two-leg freeze in the same transaction -- the PRD's
 * "seketika" requirement: a Campaign or Trip must not be able to spend
 * money that is already earmarked for return.
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

  if (subject.type === 'campaign') {
    const campaign = await tx.campaign.findUnique({ where: { id: subject.campaignId }, select: { isDemo: true } });
    if (campaign?.isDemo) {
      throw new DemoCampaignError();
    }
  }

  const priorRefunds = await tx.refund.findMany({
    where: { paymentId, status: { notIn: ['REJECTED', 'FAILED'] } },
    select: { amount: true, status: true },
  });
  const alreadyCommitted = priorRefunds
    .filter((r: { status: string }) => r.status !== 'REJECTED' && r.status !== 'FAILED')
    .reduce((sum: number, r: { amount: number }) => sum + r.amount, 0);
  const remaining = payment.amount - alreadyCommitted;
  if (amount > remaining) {
    throw new RefundExceedsRemainingError(amount, remaining);
  }

  const refund = await tx.refund.create({
    data: { paymentId, amount, reason, requestedById, status: 'REQUESTED' },
  });

  const source = sourceFor(payment, subject);
  await postTransaction(
    tx,
    refundRequestedLegs({ subject, amount, source }),
    { refundId: refund.id, paymentId, transactionId: `refund-requested-${refund.id}` },
  );

  return refund;
}

/**
 * A different Admin approves a REQUESTED Refund: posts the gross-
 * recognition settlement and lands on APPROVED. See refundApprovedLegs
 * (./ledger.ts) for the exact debit math and why "the three debits sum to
 * exactly amount" is the authoritative constraint over the spec's own
 * looser prose.
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
      throw new SelfApprovalError();
    }

    if (refund.status !== 'REQUESTED') {
      throw new InvalidRefundStatusError(refund.status);
    }

    const payment = refund.payment as unknown as PaymentWithSubjectLinks;
    const subject = paymentSubjectOf(payment);

    // Locks the subject, not the Refund row: the contended resource for the
    // shortfall computation below is the subject's pool, and a second,
    // different Refund against the same subject approved concurrently must
    // be serialised here, exactly mirroring approvePayout's own Campaign/
    // VolunteerTrip lock.
    if (subject.type === 'campaign') {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${subject.campaignId} FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM "VolunteerTrip" WHERE id = ${subject.tripId} FOR UPDATE`;
    }

    const source = sourceFor(payment, subject);
    const poolBalance = await poolBalanceFor(tx, subject, source);

    // Platform Fee is never charged anywhere in this codebase today -- no
    // Payment/Campaign field stores one, so there is nothing to multiply by
    // amount / payment.amount. Hardcoded, not derived, until such a field
    // exists; see the doc comment on refundApprovedLegs.
    const platformFeePortion = 0;
    const rawProviderFeePortion = ceilDiv(payment.providerFee * refund.amount, payment.amount);
    const providerFeePortion = Math.min(rawProviderFeePortion, refund.amount - platformFeePortion);
    const recoverableFromFrozen = refund.amount - platformFeePortion - providerFeePortion;
    const shortfall = poolBalance < 0 ? Math.min(-poolBalance, recoverableFromFrozen) : 0;

    const claimed = await tx.refund.updateMany({
      where: { id: refundId, status: 'REQUESTED' },
      data: { status: 'APPROVED', approvedById },
    });
    if (claimed.count === 0) {
      throw new InvalidRefundStatusError('unknown (changed concurrently)', 'lost the approval race');
    }

    await postTransaction(
      tx,
      refundApprovedLegs({
        subject,
        amount: refund.amount,
        platformFeePortion,
        providerFeePortion,
        shortfall,
      }),
      { refundId: refund.id, paymentId: refund.paymentId, transactionId: `refund-approved-${refund.id}` },
    );
  });

  return prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
}
