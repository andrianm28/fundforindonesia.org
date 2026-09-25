import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withRoleCheck } from '@/lib/withRoleCheck';
import { refusalResponse } from '@/lib/refusal-response';
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
 * escrow-release-at-the-top-of-the-request pattern: withRoleCheck only
 * proves "a CAMPAIGN_CREATOR-ranked user", not "this Trip's Fundraiser", so
 * getServerSession is called again here and the ownership check below is
 * what actually stops one Fundraiser from draining another's Trip.
 */
export const POST = withRoleCheck('CAMPAIGN_CREATOR', async (request: NextRequest, context: any) => {
  const { slug } = await context.params;
  const session = await getServerSession();
  const userId = session!.user!.id as string;

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
  if (trip.fundraiserId !== userId) {
    return NextResponse.json({ error: 'Anda tidak berhak mengajukan pencairan untuk trip ini' }, { status: 403 });
  }

  try {
    // No scheduler exists in this repo -- this is what makes a Trip's
    // 7-day escrow hold actually let go of money before its balance is
    // checked, the same reasoning the Campaign route already documents.
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
});

/**
 * GET /api/volunteer-trips/[slug]/payouts -- the owning Fundraiser sees
 * their Trip's Escrow Hold (settled money still inside the 7-day dispute
 * window) versus its Trip Balance (actually withdrawable). First caller of
 * tripEscrowBalance/tripBalance -- no equivalent surface exists on the
 * Campaign side yet either (see lib/money/ledger.ts's own doc comment on
 * escrowBalance, which says outright nothing has surfaced it so far).
 */
export const GET = withRoleCheck('CAMPAIGN_CREATOR', async (_request: NextRequest, context: any) => {
  const { slug } = await context.params;
  const session = await getServerSession();
  const userId = session!.user!.id as string;

  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    select: { id: true, fundraiserId: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }
  if (trip.fundraiserId !== userId) {
    return NextResponse.json({ error: 'Anda tidak berhak melihat saldo trip ini' }, { status: 403 });
  }

  const [escrowHold, tripBalanceAmount] = await prisma.$transaction((tx) =>
    Promise.all([tripEscrowBalance(tx, trip.id), tripBalance(tx, trip.id)]),
  );

  return NextResponse.json({ escrowHold, tripBalance: tripBalanceAmount });
});
