import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { batchRefusalResponse, refuseUnlessFundraiserOrAdmin } from '@/lib/refusal-response';
import { cancelBatch, completeBatch, editBatch } from '@/lib/volunteer/trip';

const editBatchSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  registrationDeadline: z.string().datetime().optional(),
  maxQuota: z.number().int().positive().optional(),
  minQuota: z.number().int().positive().optional(),
});

const actionSchema = z.object({ action: z.enum(['cancel', 'complete']) });

// Who attended (ticket 35). Optional so the older call without a list still
// completes; completeBatch judges the ids and that only the owner marks them.
const attendanceSchema = z.object({ attendedRegistrationIds: z.array(z.string().min(1)).max(1000).optional() });

const toDate = (value: string | undefined) => (value === undefined ? undefined : new Date(value));

/**
 * Edit, cancel or complete a Volunteer Batch. Each is one operation of the
 * Volunteer Trip module (src/lib/volunteer/trip.ts), which locks, judges
 * and refuses; this route parses the body and maps the answer.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug, id } = await params;

    const trip = await prisma.volunteerTrip.findUnique({
      where: { slug },
      select: { id: true, fundraiserId: true },
    });

    if (!trip) {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const refusal = refuseUnlessFundraiserOrAdmin({ kind: 'trip', ownerId: trip.fundraiserId }, session.user);
    if (refusal) return refusal;

    const operation = {
      tripId: trip.id,
      batchId: id,
      actor: { userId: session.user.id, assignments: session.user.assignments ?? [] },
    };
    const body = await request.json();

    const action = actionSchema.safeParse(body);
    if (action.success && action.data.action === 'cancel') {
      const { batch, refunds } = await cancelBatch(prisma, operation);
      return NextResponse.json({
        batch: { id: batch.id, status: batch.status },
        refundedRegistrations: refunds,
      });
    }
    if (action.success && action.data.action === 'complete') {
      const attendance = attendanceSchema.safeParse(body);
      if (!attendance.success) {
        const fieldErrors = attendance.error.flatten().fieldErrors;
        return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
      }
      const { batch } = await completeBatch(prisma, {
        ...operation,
        attendedRegistrationIds: attendance.data.attendedRegistrationIds,
      });
      return NextResponse.json({ batch: { id: batch.id, status: batch.status } });
    }

    const result = editBatchSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const { batch } = await editBatch(prisma, {
      ...operation,
      edits: {
        ...result.data,
        startDate: toDate(result.data.startDate),
        endDate: toDate(result.data.endDate),
        registrationDeadline: toDate(result.data.registrationDeadline),
      },
    });
    return NextResponse.json({ batch });
  } catch (error) {
    const refusal = batchRefusalResponse(error);
    if (refusal) return refusal;
    console.error('Error updating volunteer batch:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
