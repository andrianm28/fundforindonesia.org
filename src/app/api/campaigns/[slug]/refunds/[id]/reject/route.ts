import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { rejectRefund } from '@/lib/money/refunds';

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// Type-checked only: whether the reason is blank or over length is
// rejectRefund's own question.
const bodySchema = z.object({ reason: z.string() });

/**
 * PATCH /api/campaigns/[slug]/refunds/[id]/reject -- an Admin rejects a Refund that is not yet approved and its freeze returns to the account it was taken from
 * (ticket 49). withAssignmentCheck gates on the assignment only, so
 * getServerSession is called again to learn who acts: rejectRefund refuses
 * the Admin who requested the Refund, and this Campaign's own Fundraiser, under the subject lock.
 * Answers 409 (INVALID_REFUND_STATUS) for any other status, a second action,
 * or a lost race, with nothing written.
 */
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: RouteContext) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const actorId = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
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
    const updated = await rejectRefund(prisma, { refundId: id, rejectedById: actorId, reason: parsed.data.reason });

    return NextResponse.json({
      id: updated.id,
      paymentId: updated.paymentId,
      amount: updated.amount,
      status: updated.status,
      rejectedById: updated.rejectedById,
      rejectedAt: updated.rejectedAt,
    });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error rejecting refund:', error);
    return NextResponse.json({ error: 'Gagal menolak refund' }, { status: 500 });
  }
});
