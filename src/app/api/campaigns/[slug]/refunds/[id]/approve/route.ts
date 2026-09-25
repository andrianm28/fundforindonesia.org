import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { lifecycleErrorToHttp } from '@/lib/campaign-lifecycle';
import {
  approveRefund,
  RefundNotFoundError,
  SelfApprovalError,
  InvalidRefundStatusError,
} from '@/lib/money/refunds';

/**
 * PATCH /api/campaigns/[slug]/refunds/[id]/approve -- a different Admin
 * approves a REQUESTED Refund and posts its settlement in the same action.
 */
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (_request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

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
    const updated = await approveRefund(prisma, { refundId: id, approvedById });

    return NextResponse.json({
      id: updated.id,
      paymentId: updated.paymentId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
    });
  } catch (error) {
    if (error instanceof RefundNotFoundError) {
      return NextResponse.json({ error: 'Refund tidak ditemukan' }, { status: 404 });
    }
    if (error instanceof SelfApprovalError) {
      return NextResponse.json({ error: 'Refund tidak dapat disetujui oleh orang yang mengajukannya' }, { status: 403 });
    }
    // OwnCampaignConflictError: the lifecycle module owns its status and body.
    const refusal = lifecycleErrorToHttp(error);
    if (refusal) {
      return NextResponse.json(refusal.body, { status: refusal.status });
    }
    if (error instanceof InvalidRefundStatusError) {
      return NextResponse.json({ error: 'Refund tidak lagi menunggu persetujuan' }, { status: 409 });
    }
    console.error('Error approving refund:', error);
    return NextResponse.json({ error: 'Gagal menyetujui refund' }, { status: 500 });
  }
});
