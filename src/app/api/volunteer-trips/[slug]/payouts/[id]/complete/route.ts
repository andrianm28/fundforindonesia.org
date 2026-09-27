import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { completePayout } from '@/lib/money/payouts';

const completePayoutSchema = z.object({
  proofImage: z.string().trim().min(1, 'Bukti transfer wajib dilampirkan'),
});

type RouteContext = { params: Promise<{ slug: string; id: string }> };

/**
 * POST /api/volunteer-trips/[slug]/payouts/[id]/complete -- the second Admin
 * records that a Trip Fee payout has moved.
 *
 * Mirrors POST /api/campaigns/[slug]/payouts/[id]/complete exactly. A Trip
 * Fee rides the same Payment, Escrow Hold and Payout path as a Donation
 * (CONTEXT.md, Trip Fee; ADR 0014), so it needs the same two-person rule
 * and the same proof: without this route a Trip Payout could be approved
 * and never completed, and the money would sit in PAYOUT_CLEARING for ever
 * with nothing able to drain it. The two differences are inside
 * completePayout, which already branches on which subject the Payout
 * carries: it locks the VolunteerTrip rather than the Campaign, and a Trip
 * has no status rule, so a Trip's payout completes whatever the Trip's
 * status is.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: RouteContext) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const completedById = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = completePayoutSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }

  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }

  const payout = await prisma.payout.findUnique({ where: { id }, select: { volunteerTripId: true } });
  if (!payout || payout.volunteerTripId !== trip.id) {
    return NextResponse.json({ error: 'Payout tidak ditemukan' }, { status: 404 });
  }

  try {
    const updated = await completePayout(prisma, {
      payoutId: id,
      completedById,
      proofImage: parsed.data.proofImage,
    });

    return NextResponse.json({
      id: updated.id,
      volunteerTripId: updated.volunteerTripId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
      approvedAt: updated.approvedAt,
      completedById: updated.completedById,
      completedAt: updated.completedAt,
      proofImage: updated.proofImage,
    });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error completing trip payout:', error);
    return NextResponse.json({ error: 'Gagal menandai pencairan selesai' }, { status: 500 });
  }
});
