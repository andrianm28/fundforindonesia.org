import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { completeRefund } from '@/lib/money/refunds';

const completeRefundSchema = z.object({
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
 * POST /api/volunteer-trips/[slug]/refunds/[id]/complete -- the Trip-scoped
 * twin of the Campaign completion route
 * (src/app/api/campaigns/[slug]/refunds/[id]/complete/route.ts).
 * completeRefund itself is already subject-agnostic; the only thing
 * genuinely different here is this route's own Trip-vs-Campaign scoping
 * lookup, the same structural mirror the approve routes already are.
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
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error completing refund:', error);
    return NextResponse.json({ error: 'Gagal menandai refund selesai' }, { status: 500 });
  }
});
