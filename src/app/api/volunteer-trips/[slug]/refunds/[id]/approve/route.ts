import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import {
  approveRefund,
  RefundNotFoundError,
  SelfApprovalError,
  InvalidRefundStatusError,
} from '@/lib/money/refunds';

/**
 * PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve -- a different Admin
 * approves a REQUESTED Refund and posts its settlement in the same action.
 *
 * Structural mirror of the Campaign sibling route
 * (src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts): approveRefund
 * itself is already subject-agnostic and needs no Trip-specific logic at
 * all -- the only thing genuinely different here is this route's own
 * Trip-vs-Campaign scoping lookup.
 */
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (_request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

  const trip = await prisma.volunteerTrip.findUnique({ where: { slug }, select: { id: true } });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }

  const refund = await prisma.refund.findUnique({
    where: { id },
    select: { payment: { select: { registration: { select: { batch: { select: { tripId: true } } } } } } },
  });
  if (!refund || refund.payment.registration?.batch.tripId !== trip.id) {
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
    if (error instanceof InvalidRefundStatusError) {
      return NextResponse.json({ error: 'Refund tidak lagi menunggu persetujuan' }, { status: 409 });
    }
    console.error('Error approving refund:', error);
    return NextResponse.json({ error: 'Gagal menyetujui refund' }, { status: 500 });
  }
});
