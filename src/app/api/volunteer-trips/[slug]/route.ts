import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { coverImageSchema } from '@/lib/cover-image';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refusalResponse, refuseUnlessFundraiserOrAdmin } from '@/lib/refusal-response';
import { PUBLIC_BATCH_SELECT, PUBLIC_TRIP_DETAIL_SELECT } from '@/lib/volunteer/trip-public';
import { submitTrip, TRIP_EDITABLE_STATUSES, tripFeeAmountSchema } from '@/lib/volunteer/trip';

const editVolunteerTripSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  story: z.string().min(1).optional(),
  coverImage: coverImageSchema.optional(),
  destination: z.string().min(1).optional(),
  itinerary: z.string().min(1).optional(),
  tripFeeAmount: tripFeeAmountSchema.optional(),
  action: z.enum(['submit']).optional(),
});

// The full row (including fundraiserId) goes back to the Trip's owner or an
// Admin, the only callers refuseUnlessFundraiserOrAdmin lets through; the
// public GET below never returns it.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug } = await params;

    const trip = await prisma.volunteerTrip.findUnique({
      where: { slug },
      select: { id: true, fundraiserId: true, status: true },
    });

    if (!trip) {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const refusal = refuseUnlessFundraiserOrAdmin({ kind: 'trip', ownerId: trip.fundraiserId }, session.user);
    if (refusal) return refusal;

    const body = await request.json();
    const result = editVolunteerTripSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const { action, ...fields } = result.data;

    // Submitting is judged by submitTrip under the Trip's row lock: the
    // status, the owner-only Capacity, the log. Fields sent with the submit
    // are written with it.
    if (action === 'submit') {
      const { trip: submitted } = await submitTrip(prisma, {
        tripId: trip.id,
        actor: { userId: session.user.id, assignments: session.user.assignments ?? [] },
        edits: fields,
      });
      return NextResponse.json({ trip: submitted });
    }

    // A plain edit changes no status, so it is judged by the write itself:
    // predicated on the editable statuses, never on the status read above,
    // which a submit or decision may have changed since.
    const { count } = await prisma.volunteerTrip.updateMany({
      where: { id: trip.id, status: { in: [...TRIP_EDITABLE_STATUSES] } },
      data: fields,
    });
    if (count === 0) {
      return NextResponse.json(
        { error: 'Trip tidak bisa diedit pada status ini' },
        { status: 400 },
      );
    }

    const updated = await prisma.volunteerTrip.findUnique({ where: { id: trip.id } });
    return NextResponse.json({ trip: updated });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error updating volunteer trip:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    const trip = await prisma.volunteerTrip.findUnique({ where: { slug }, select: PUBLIC_TRIP_DETAIL_SELECT });

    if (!trip || trip.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const batches = await prisma.volunteerBatch.findMany({
      where: { tripId: trip.id, status: 'OPEN' },
      select: PUBLIC_BATCH_SELECT,
      orderBy: { startDate: 'asc' },
    });

    const batchesWithRemaining = await Promise.all(
      batches.map(async (batch) => {
        const occupied = await prisma.registration.count({
          where: { batchId: batch.id, status: { in: ['HOLD', 'CONFIRMED'] } },
        });
        return { ...batch, remainingQuota: Math.max(0, batch.maxQuota - occupied) };
      }),
    );

    return NextResponse.json({ trip: { ...trip, batches: batchesWithRemaining } });
  } catch (error) {
    console.error('Error fetching volunteer trip:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
