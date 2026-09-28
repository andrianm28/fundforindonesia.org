import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { completeRefund } from '@/lib/money/refunds';

const completeRefundSchema = z.object({
  // Type-checked only, exactly like the Payout twin: whether a field is
  // blank, whitespace-only or over length is completeRefund's own question,
  // asked through the same shared validators (@/lib/payout-proof,
  // ./cleanDestinationText) the Admin's form asks before submitting.
  // donorAccountNumber (Q7(c)) is the completing Admin's RE-TYPED number,
  // compared server-side against the one the approving Admin recorded --
  // this route never accepts a bank code or account name of its own any
  // more.
  proofReference: z.string(),
  proofNote: z.string(),
  donorAccountNumber: z.string(),
});

type RouteContext = { params: Promise<{ slug: string; id: string }> };

/**
 * POST /api/campaigns/[slug]/refunds/[id]/complete -- a third Admin, neither
 * the one who requested this Refund nor the one who approved it, records
 * that the Admin has transferred the money by hand to the Donor's account
 * (CONTEXT.md, Refund; PRD §7.2; ticket 31), re-typing the account number
 * the approving Admin already recorded as the second pair of eyes (Q7(c),
 * ADR 0018 Amendment 2026-09-28) -- this route never accepts a destination
 * of its own.
 *
 * Structural mirror of the Payout completion route
 * (src/app/api/campaigns/[slug]/payouts/[id]/complete/route.ts):
 * withAssignmentCheck(Assignment.ADMIN) gates on the assignment only, so
 * getServerSession is called again to learn who is completing -- the
 * identity completeRefund compares against both the requester and the
 * approver, under the subject row lock, which is what keeps the check true
 * against a concurrent Suspension.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: RouteContext) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const completedById = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = completeRefundSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const refund = await prisma.refund.findUnique({
    where: { id },
    select: { payment: { select: { donation: { select: { campaignId: true } } } } },
  });
  if (!refund || refund.payment.donation?.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Refund tidak ditemukan' }, { status: 404 });
  }

  try {
    const updated = await completeRefund(prisma, {
      refundId: id,
      completedById,
      proofReference: parsed.data.proofReference,
      proofNote: parsed.data.proofNote,
      donorAccountNumber: parsed.data.donorAccountNumber,
    });

    return NextResponse.json({
      id: updated.id,
      paymentId: updated.paymentId,
      amount: updated.amount,
      status: updated.status,
      completedById: updated.completedById,
      completedAt: updated.completedAt,
    });
  } catch (error) {
    // Every refusal carries its own code and answers its own status:
    // TWO_PERSON_RULE when the requester or the approver tries to complete
    // their own Refund, REFUND_PROOF_INVALID for a blank or over-length
    // proof field, REFUND_DESTINATION_INVALID for a blank re-typed number,
    // REFUND_DESTINATION_MISMATCH (Q7(c)) when it does not match what the
    // approving Admin recorded, and INVALID_REFUND_STATUS when the Refund
    // is not APPROVED.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error completing refund:', error);
    return NextResponse.json({ error: 'Gagal menandai refund selesai' }, { status: 500 });
  }
});
