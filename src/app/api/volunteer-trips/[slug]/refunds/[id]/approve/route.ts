import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { approveRefund } from '@/lib/money/refunds';

const approveRefundSchema = z.object({
  donorBankCode: z.string(),
  donorAccountName: z.string(),
  donorAccountNumber: z.string(),
});

/**
 * PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve -- a different Admin
 * approves a REQUESTED Refund, records the Donor destination from their
 * written request, and posts the settlement in the same action.
 *
 * Structural mirror of the Campaign sibling route
 * (src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts): approveRefund
 * itself is already subject-agnostic and needs no Trip-specific logic at
 * all -- the only thing genuinely different here is this route's own
 * Trip-vs-Campaign scoping lookup.
 */
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = approveRefundSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }

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
    const updated = await approveRefund(prisma, {
      refundId: id,
      approvedById,
      donorBankCode: parsed.data.donorBankCode,
      donorAccountName: parsed.data.donorAccountName,
      donorAccountNumber: parsed.data.donorAccountNumber,
    });

    return NextResponse.json({
      id: updated.id,
      paymentId: updated.paymentId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
    });
  } catch (error) {
    // Every refusal carries its own code and answers its own status.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error approving refund:', error);
    return NextResponse.json({ error: 'Gagal menyetujui refund' }, { status: 500 });
  }
});
