import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { Role } from '@/generated/prisma/client';

const createBatchSchema = z
  .object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    registrationDeadline: z.string().datetime(),
    maxQuota: z.number().int().positive('maxQuota harus lebih dari 0'),
    minQuota: z.number().int().positive('minQuota harus lebih dari 0'),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: 'endDate tidak boleh sebelum startDate',
    path: ['endDate'],
  })
  .refine((data) => new Date(data.registrationDeadline) <= new Date(data.startDate), {
    message: 'registrationDeadline tidak boleh setelah startDate',
    path: ['registrationDeadline'],
  })
  .refine((data) => data.minQuota <= data.maxQuota, {
    message: 'minQuota tidak boleh melebihi maxQuota',
    path: ['minQuota'],
  });

// A Batch can be added to a Trip in any status except CANCELLED -- adding a
// new date to an already-approved Trip is a normal operation (opening a new
// intake for a recurring destination), and a Fundraiser filling in a Trip's
// details before first submitting it needs to add Batches too. A cancelled
// Trip is done; nothing should extend it. (Ruling: not explicitly settled by
// the ticket; this is the controller's call, recorded here rather than in a
// separate ledger since it's a small, self-contained decision.)
const BATCH_ADDABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'REJECTED', 'ACTIVE', 'SUSPENDED'];

export async function POST(
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

    if (!BATCH_ADDABLE_STATUSES.includes(trip.status)) {
      return NextResponse.json(
        { error: 'Tidak bisa menambah batch pada trip dengan status ini' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const result = createBatchSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const { startDate, endDate, registrationDeadline, maxQuota, minQuota } = result.data;

    const batch = await prisma.volunteerBatch.create({
      data: {
        tripId: trip.id,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        registrationDeadline: new Date(registrationDeadline),
        maxQuota,
        minQuota,
        status: 'OPEN',
      },
    });

    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    console.error('Error creating volunteer batch:', error);
    return NextResponse.json({ error: 'Gagal membuat volunteer batch' }, { status: 500 });
  }
}
