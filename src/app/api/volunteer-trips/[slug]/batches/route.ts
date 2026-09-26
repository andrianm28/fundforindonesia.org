import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { batchRefusalResponse, refuseUnlessFundraiserOrAdmin } from '@/lib/refusal-response';
import { createBatch } from '@/lib/volunteer/trip';

// The shape only. Whether the dates and quotas agree with each other, and
// whether the Trip takes new Batches, is createBatch's to judge.
const createBatchSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  registrationDeadline: z.string().datetime(),
  maxQuota: z.number().int().positive('maxQuota harus lebih dari 0'),
  minQuota: z.number().int().positive('minQuota harus lebih dari 0'),
});

/**
 * Add a Volunteer Batch to a Trip: the Volunteer Trip module's createBatch
 * (src/lib/volunteer/trip.ts); this route parses the body and maps the
 * answer.
 */
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
      select: { id: true, fundraiserId: true },
    });

    if (!trip) {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const refusal = refuseUnlessFundraiserOrAdmin({ kind: 'trip', ownerId: trip.fundraiserId }, session.user);
    if (refusal) return refusal;

    const body = await request.json();
    const result = createBatchSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const { batch } = await createBatch(prisma, {
      tripId: trip.id,
      actor: { userId: session.user.id, assignments: session.user.assignments ?? [] },
      fields: {
        ...result.data,
        startDate: new Date(result.data.startDate),
        endDate: new Date(result.data.endDate),
        registrationDeadline: new Date(result.data.registrationDeadline),
      },
    });

    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    const refusal = batchRefusalResponse(error);
    if (refusal) return refusal;
    console.error('Error creating volunteer batch:', error);
    return NextResponse.json({ error: 'Gagal membuat volunteer batch' }, { status: 500 });
  }
}
