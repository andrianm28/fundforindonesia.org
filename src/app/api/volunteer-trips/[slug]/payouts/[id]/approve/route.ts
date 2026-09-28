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
 *
 * The provider balance is required here exactly as it is on the Campaign route,
 * and for the same reason: a Trip Fee lands at the payment provider just as a
 * Donation does (ADR 0014 keeps a Trip out of Campaign.Kind; it says nothing
 * about which provider took the money), so the money a Trip Payout pays out has
 * to be at the provider for the transfer to succeed -- and no provider this
 * platform talks to exposes a balance API (ADR 0006). The reading is a human's,
 * and approvePayout refuses both a missing one and one that is short.
 *
 * `provider` is forwarded exactly as the body held it, as on the Campaign
 * route: the spelling is resolved where the name becomes money, so this route
 * records the one name the registry knows and refuses one that names nothing.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: any) => {
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

  // Read after the Payout has been located, so a request for a Payout that does
  // not exist still answers 404 rather than complaining about a provider
  // balance the caller was never going to be allowed to use.
  const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;

  try {
    const updated = await approvePayout(prisma, {
      payoutId: id,
      approvedById,
      provider: typeof body?.provider === 'string' ? body.provider : '',
      providerBalance: body?.providerBalance as number,
    });

    return NextResponse.json({
      id: updated.id,
      volunteerTripId: updated.volunteerTripId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
      approvedAt: updated.approvedAt,
      approvedProvider: updated.approvedProvider,
      approvedProviderBalance: updated.approvedProviderBalance,
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
