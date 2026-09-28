import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refusalResponse, refuseUnlessFundraiser } from '@/lib/refusal-response';
import { requestPayout } from '@/lib/money/payouts';
import { releaseMaturedEscrow } from '@/lib/money/escrow';
import { tripBalance, tripEscrowBalance } from '@/lib/money/ledger';

const requestPayoutSchema = z.object({
  bankAccountId: z.string().min(1, 'Rekening bank harus dipilih'),
  amount: z.number().int('Jumlah harus berupa bilangan bulat').min(1, 'Jumlah pencairan harus lebih dari 0'),
  description: z.string().min(1, 'Keterangan harus diisi').max(500, 'Keterangan maksimal 500 karakter'),
});

/**
 * POST /api/volunteer-trips/[slug]/payouts -- the owning Fundraiser requests
 * a payout of their Trip's withdrawable TRIP_BALANCE.
 *
 * Mirrors POST /api/campaigns/[slug]/payouts exactly, including the
 * escrow-release-at-the-top-of-the-request pattern. Any signed-in user may
 * ask; no Role is needed. The Capacity judgement below (only this Trip's
 * Fundraiser) is what stops one person from draining another's Trip.
 */
export async function POST(request: NextRequest, context: any) {
  const { slug } = await context.params;
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id as string;

  const body = await request.json().catch(() => null);
  const parsed = requestPayoutSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }
  const { bankAccountId, amount, description } = parsed.data;

  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    select: { id: true, fundraiserId: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }
  const refusal = refuseUnlessFundraiser({ kind: 'trip', ownerId: trip.fundraiserId }, session.user);
  if (refusal) return refusal;

  try {
    // Two paths sweep matured holds: this one, for the requesting Trip
    // alone, and `runScheduledJobs` (src/lib/scheduled-jobs.ts), the
    // second, which sweeps every subject at once. Being callable is not
    // being called: nothing invokes the scheduled path until an owner
    // installs the scheduler (ticket 45), so today this request-time sweep
    // is the only one that moves money -- without it, a Trip's 7-day
    // escrow hold would still be in ESCROW_HOLD when its balance is
    // checked. The same reasoning the Campaign route documents.
    await releaseMaturedEscrow({ type: 'trip', id: trip.id });

    const payout = await prisma.$transaction((tx) =>
      requestPayout(tx, {
        subject: { type: 'trip', tripId: trip.id },
        requestedById: userId,
        bankAccountId,
        amount,
        description,
      }),
    );

    return NextResponse.json(
      {
        id: payout.id,
        volunteerTripId: payout.volunteerTripId,
        bankAccountId: payout.bankAccountId,
        amount: payout.amount,
        description: payout.description,
        status: payout.status,
        createdAt: payout.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    // Every refusal carries its own code and answers its own status.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error requesting trip payout:', error);
    return NextResponse.json({ error: 'Gagal mengajukan pencairan' }, { status: 500 });
  }
}

/**
 * GET /api/volunteer-trips/[slug]/payouts -- the owning Fundraiser sees
 * their Trip's Escrow Hold (settled money still inside the 7-day dispute
 * window) versus its Trip Balance (actually withdrawable). First caller of
 * tripEscrowBalance/tripBalance -- no equivalent surface exists on the
 * Campaign side yet either (see lib/money/ledger.ts's own doc comment on
 * escrowBalance, which says outright nothing has surfaced it so far).
 * Only this Trip's Fundraiser may look; no Role is needed.
 */
export async function GET(_request: NextRequest, context: any) {
  const { slug } = await context.params;
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    select: { id: true, fundraiserId: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }
  const refusal = refuseUnlessFundraiser({ kind: 'trip', ownerId: trip.fundraiserId }, session.user);
  if (refusal) return refusal;

  const [escrowHold, tripBalanceAmount] = await prisma.$transaction((tx) =>
    Promise.all([tripEscrowBalance(tx, trip.id), tripBalance(tx, trip.id)]),
  );

  return NextResponse.json({ escrowHold, tripBalance: tripBalanceAmount });
}
