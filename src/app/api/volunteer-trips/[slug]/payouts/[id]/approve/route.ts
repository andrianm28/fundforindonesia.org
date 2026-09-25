import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { approvePayout } from '@/lib/money/payouts';

/**
 * POST /api/volunteer-trips/[slug]/payouts/[id]/approve -- an Admin approves
 * a DRAFT Trip payout and releases it in the same action.
 *
 * Mirrors POST /api/campaigns/[slug]/payouts/[id]/approve exactly:
 * withAssignmentCheck(Assignment.ADMIN) gates on the assignment only and
 * does not pass the session to the handler, so getServerSession is called
 * again here to learn who is approving -- that identity is what the
 * two-person check inside approvePayout compares against requestedById.
 * approvePayout itself already branches on which of
 * campaignId/volunteerTripId the Payout row has set, so no Trip-specific
 * call is needed here beyond loading the row and checking it belongs to
 * this Trip.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (_request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

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
    const updated = await approvePayout(prisma, { payoutId: id, approvedById });

    return NextResponse.json({
      id: updated.id,
      volunteerTripId: updated.volunteerTripId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
      approvedAt: updated.approvedAt,
      providerRef: updated.providerRef,
    });
  } catch (error) {
    // Every refusal carries its own code and answers its own status.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error approving trip payout:', error);
    return NextResponse.json({ error: 'Gagal menyetujui pencairan' }, { status: 500 });
  }
});
