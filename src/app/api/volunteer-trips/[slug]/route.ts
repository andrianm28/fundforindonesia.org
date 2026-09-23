import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { Role } from '@/generated/prisma/client';

const editVolunteerTripSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  story: z.string().min(1).optional(),
  coverImage: z.string().url().optional(),
  destination: z.string().min(1).optional(),
  itinerary: z.string().min(1).optional(),
  tripFeeAmount: z.number().positive().optional(),
  action: z.enum(['submit']).optional(),
});

const EDITABLE_STATUSES = ['DRAFT', 'REJECTED'];

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

    const userRole = (session.user.role as Role) ?? 'DONOR';
    const isAdmin = userRole === 'ADMIN';
    const isOwner = isAtLeast(userRole, 'CAMPAIGN_CREATOR') && trip.fundraiserId === session.user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!EDITABLE_STATUSES.includes(trip.status)) {
      return NextResponse.json(
        { error: 'Trip tidak bisa diedit pada status ini' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const result = editVolunteerTripSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const { action, ...fields } = result.data;

    const updated = await prisma.volunteerTrip.update({
      where: { id: trip.id },
      data: {
        ...fields,
        ...(action === 'submit' ? { status: 'SUBMITTED' } : {}),
      },
    });

    return NextResponse.json({ trip: updated });
  } catch (error) {
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

    const trip = await prisma.volunteerTrip.findUnique({ where: { slug } });

    if (!trip || trip.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const batches = await prisma.volunteerBatch.findMany({
      where: { tripId: trip.id, status: 'OPEN' },
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
