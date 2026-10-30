import type { PrismaClient, Refund } from '@/generated/prisma/client';
import { lockAndLoad } from '@/lib/subject-guard';
import { createRefund } from './refunds';
import { PaymentNotPaidError, RefundReasonInvalidError } from './errors';
import { readDonorRefundConfig } from './donor-refund-config';
import { DonorRefundDisabledError, DonorRefundNotEligibleError, DonorRefundTooManyOpenError } from './donor-refund-errors';

/**
 * A Donor asks for a Refund of their own Donation (CONTEXT.md, Refund; PRD
 * 7.2, Donor-initiated row). Until now only an Admin could start one.
 *
 * THE REQUEST IS A REFUND, NOT A SEPARATE RECORD. It goes through the same
 * createRefund an Admin uses, as a Refund in REQUESTED with the Donor as
 * `requestedBy`: the PRD already defines REQUESTED as "created, and its
 * money frozen at once", and the Admin then approves or rejects it on the
 * existing screens and routes (approveRefund, rejectRefund), which is where
 * a rejection's reason is recorded. No money leaves the platform on a
 * request; what moves is the freeze, which also stops a Payout from taking
 * the money while the request waits. No ledger logic is repeated here.
 * Which Refunds were started by a Donor is not stored: it is read off
 * whether the requester is the Donation's own Donor (isDonorInitiatedRefund).
 *
 * THE GUARDS LIVE HERE, not in the route or the button, and are judged under
 * the Campaign lock createRefund will also take, so a Payout approved in the
 * same instant is either seen by the check or waits behind the freeze:
 *   - the Donation is the caller's own (a guest Donation has no owner to
 *     match, so it is out of scope and refused as not found);
 *   - a window since Settlement, and a cap per Kind, both from the
 *     environment (./donor-refund-config.ts; no value is in this repository,
 *     and an unset one switches the feature off);
 *   - no Payout has drawn on the Campaign: see PAYOUTS_THAT_DREW;
 *   - the Donor has fewer than the allowed number of requests waiting.
 * createRefund's own rules (cumulative cap on the Payment, the Kind's
 * technical-failure rule, Demo Campaign, anonymisation) still apply on top.
 */

/**
 * "Before Payout", precisely: the money was Settled into one Campaign pool
 * and every Payout draws on that pool, so a request is allowed only while no
 * Payout of the Campaign has claimed it. SUBMITTED, APPROVED and PROCESSING
 * are in flight (the pool is, or is about to be, drawn down); COMPLETED has
 * left. DRAFT is not yet a request for money, and REJECTED and FAILED
 * returned it, so none of those three stop a Donor. This is deliberately
 * wider than "a Payout Completed" (Cancellation's rule): a Donor-initiated
 * Refund must not race a Payout that is already on its way.
 */
const PAYOUTS_THAT_DREW = ['SUBMITTED', 'APPROVED', 'PROCESSING', 'COMPLETED'] as const;

/** A Refund still waiting for, or on its way through, the Admin steps. */
const OPEN_REFUND_STATUSES = ['REQUESTED', 'AWAITING_DONOR_DETAILS', 'APPROVED', 'PROCESSING'] as const;

const MAX_REASON_LENGTH = 500;

export async function requestDonorRefund(
  prisma: PrismaClient,
  params: {
    donorId: string;
    donationId: string;
    amount: number;
    reason: string;
    /** Injectable for tests. */
    now?: Date;
    env?: Record<string, string | undefined>;
  },
): Promise<Refund> {
  const { donorId, donationId, amount } = params;
  const now = params.now ?? new Date();

  const config = readDonorRefundConfig(params.env);
  if (!config) throw new DonorRefundDisabledError();

  const reason = params.reason.trim();
  if (reason === '') throw new RefundReasonInvalidError('Alasan wajib diisi.');
  if (reason.length > MAX_REASON_LENGTH) {
    throw new RefundReasonInvalidError(`Alasan maksimal ${MAX_REASON_LENGTH} karakter.`);
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DonorRefundNotEligibleError('AMOUNT_INVALID');

  return prisma.$transaction(async (tx) => {
    // Serialises one Donor's requests, which sit on different Campaign locks,
    // so the open-request count below cannot be passed by two at once. Nothing
    // else takes this lock, so it cannot join a cycle.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`donor-refund:${donorId}`}))`;

    const donation = await tx.donation.findUnique({
      where: { id: donationId },
      select: {
        donorId: true,
        campaignId: true,
        campaign: { select: { kind: true } },
        payments: { where: { status: 'PAID' }, select: { id: true, settledAt: true } },
      },
    });
    // Somebody else's Donation, a guest Donation (donorId null) and a missing
    // one all answer alike, so the id says nothing about who owns it.
    if (!donation || donation.donorId !== donorId) throw new DonorRefundNotEligibleError('NOT_OWNER');

    const payment = donation.payments[0];
    if (!payment) throw new PaymentNotPaidError(donationId, 'not PAID');

    const cap = config.maxAmountByKind[donation.campaign.kind];
    if (cap === undefined) throw new DonorRefundNotEligibleError('KIND_NOT_ALLOWED');
    if (amount > cap) throw new DonorRefundNotEligibleError('AMOUNT_OVER_LIMIT');

    // An unknown settledAt cannot show the window is still open.
    if (!payment.settledAt || now.getTime() - payment.settledAt.getTime() > config.windowHours * 3_600_000) {
      throw new DonorRefundNotEligibleError('WINDOW_CLOSED');
    }

    const subject = { type: 'campaign' as const, campaignId: donation.campaignId };
    // Same lock createRefund takes next (re-entrant inside one transaction), so
    // the Payout check below and the freeze that follows are one step to a
    // Payout approval running at the same time.
    await lockAndLoad(tx, subject, now);

    const payoutsThatDrew = await tx.payout.count({
      where: { campaignId: donation.campaignId, status: { in: [...PAYOUTS_THAT_DREW] } },
    });
    if (payoutsThatDrew > 0) throw new DonorRefundNotEligibleError('PAYOUT_ALREADY_DREW');

    const open = await tx.refund.count({
      where: { requestedById: donorId, status: { in: [...OPEN_REFUND_STATUSES] } },
    });
    if (open >= config.maxOpenPerDonor) throw new DonorRefundTooManyOpenError();

    return createRefund(tx, { subject, paymentId: payment.id, amount, reason, requestedById: donorId });
  });
}

/**
 * Whether a Refund was started by the Donor of the Donation it refunds, for
 * the Admin screens to say so. Read, not stored: the schema has no column for
 * it, and "the requester is the Donor" is exactly what it means.
 */
export function isDonorInitiatedRefund(refund: {
  requestedById: string;
  payment: { donation: { donorId: string | null } | null };
}): boolean {
  const donorId = refund.payment.donation?.donorId;
  return donorId != null && donorId === refund.requestedById;
}
