import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { refuseUnlessFundraiser } from '@/lib/refusal-response';
import { Role } from '@/generated/prisma/client';
import { createRefund } from '@/lib/money/refunds';

const editBatchSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  registrationDeadline: z.string().datetime().optional(),
  maxQuota: z.number().int().positive().optional(),
  minQuota: z.number().int().positive().optional(),
});

const cancelActionSchema = z.object({
  action: z.literal('cancel'),
});

const completeActionSchema = z.object({
  action: z.literal('complete'),
});

class MinQuotaMetError extends Error {}
class BatchNotOpenError extends Error {}

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

    const batch = await prisma.volunteerBatch.findUnique({
      where: { id },
      select: {
        id: true,
        tripId: true,
        status: true,
        maxQuota: true,
        minQuota: true,
        startDate: true,
        endDate: true,
        registrationDeadline: true,
      },
    });

    if (!batch || batch.tripId !== trip.id) {
      return NextResponse.json({ error: 'Volunteer batch tidak ditemukan' }, { status: 404 });
    }

    const userRole = (session.user.role as Role) ?? 'DONOR';
    const isAdmin = userRole === 'ADMIN';

    if (!isAdmin) {
      // Still gated by the legacy CAMPAIGN_CREATOR Role until who may create
      // a Campaign is decided (prd-compliance tickets 06-08).
      if (!isAtLeast(userRole, 'CAMPAIGN_CREATOR')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const refusal = refuseUnlessFundraiser({ kind: 'trip', ownerId: trip.fundraiserId }, session.user);
      if (refusal) return refusal;
    }

    if (batch.status !== 'OPEN') {
      return NextResponse.json(
        { error: 'Batch tidak bisa diedit pada status ini' },
        { status: 400 },
      );
    }

    const body = await request.json();

    const cancelParsed = cancelActionSchema.safeParse(body);
    if (cancelParsed.success) {
      const requestedById = session.user.id as string;

      try {
        // Locks the Batch row, then locks every HOLD/CONFIRMED Registration
        // on it, in one FOR UPDATE read -- so a Registration confirming
        // concurrently (the settlement webhook, racing this cancel) either
        // commits before this lock is taken (and is then locked and
        // cancelled/refunded like any other CONFIRMED row) or blocks until
        // this transaction commits (and is cancelled by whatever handles it
        // next against an already-CANCELLED Batch). Two concurrent cancel
        // attempts on the same Batch serialize on the same lock: the loser's
        // own locked read comes back empty (every Registration already
        // CANCELLED), so it returns a clean 200 with no refunds rather than
        // racing a partial refund.
        //
        // HOLD Registrations are cancelled alongside CONFIRMED ones -- a
        // Batch cancellation must stop anyone from still paying into a trip
        // that won't run -- but only CONFIRMED Registrations get a Refund: a
        // HOLD Registration's Payment hasn't settled, so there's nothing to
        // refund yet, mirroring the Volunteer self-cancel route's identical
        // HOLD rule (src/app/api/registrations/[id]/route.ts).
        const result = await prisma.$transaction(async (tx) => {
          const [lockedBatch] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
            SELECT id, status FROM "VolunteerBatch" WHERE id = ${batch.id} FOR UPDATE
          `;

          // Re-checks status under the lock -- the read taken before this
          // transaction opened can be stale if a concurrent `complete`
          // action claimed this Batch in between. Without this check, an
          // in-flight cancel could cancel-and-refund a Batch that already
          // completed.
          if (lockedBatch.status !== 'OPEN') {
            throw new BatchNotOpenError();
          }

          const lockedRegistrations = await tx.$queryRaw<Array<{ id: string; status: string }>>`
            SELECT id, status FROM "Registration"
            WHERE "batchId" = ${batch.id} AND status IN ('HOLD', 'CONFIRMED')
            FOR UPDATE
          `;

          const confirmedIds = lockedRegistrations.filter((r) => r.status === 'CONFIRMED').map((r) => r.id);
          const holdIds = lockedRegistrations.filter((r) => r.status === 'HOLD').map((r) => r.id);

          if (confirmedIds.length >= batch.minQuota) {
            throw new MinQuotaMetError();
          }

          const cancelledBatch = await tx.volunteerBatch.update({
            where: { id: batch.id },
            data: { status: 'CANCELLED' },
          });

          const confirmedRegistrations = await tx.registration.findMany({
            where: { id: { in: confirmedIds } },
            select: { id: true, payment: { select: { id: true, amount: true } } },
          });

          await tx.registration.updateMany({
            where: { id: { in: [...confirmedIds, ...holdIds] } },
            data: { status: 'CANCELLED' },
          });

          const refunds: Array<{ registrationId: string; refundId: string; amount: number }> = [];
          for (const registration of confirmedRegistrations) {
            // A CONFIRMED Registration always has a settled Payment (see
            // prisma/schema.prisma's own comment on Registration.status).
            const payment = registration.payment!;
            const refund = await createRefund(tx, {
              subject: { type: 'trip', tripId: batch.tripId },
              paymentId: payment.id,
              amount: payment.amount,
              reason: 'Batch dibatalkan karena tidak mencapai kuota minimum',
              requestedById,
            });
            refunds.push({ registrationId: registration.id, refundId: refund.id, amount: refund.amount });
          }

          return { batch: cancelledBatch, refunds };
        });

        return NextResponse.json({
          batch: { id: result.batch.id, status: result.batch.status },
          refundedRegistrations: result.refunds,
        });
      } catch (error) {
        if (error instanceof MinQuotaMetError) {
          return NextResponse.json(
            { error: 'Batch sudah mencapai kuota minimum, tidak bisa dibatalkan' },
            { status: 400 },
          );
        }
        if (error instanceof BatchNotOpenError) {
          return NextResponse.json(
            { error: 'Batch tidak bisa diedit pada status ini' },
            { status: 400 },
          );
        }
        throw error;
      }
    }

    const completeParsed = completeActionSchema.safeParse(body);
    if (completeParsed.success) {
      if (batch.endDate > new Date()) {
        return NextResponse.json(
          { error: 'Batch belum bisa diselesaikan sebelum endDate' },
          { status: 400 },
        );
      }

      // Claims the OPEN -> COMPLETED transition with a predicate-based
      // update, not a plain one -- so a concurrent Batch cancellation
      // (which locks the row and re-checks its own status, see below)
      // can't be silently overwritten back to COMPLETED, and this route
      // can't complete a Batch a concurrent cancel already claimed.
      const claimed = await prisma.volunteerBatch.updateMany({
        where: { id: batch.id, status: 'OPEN' },
        data: { status: 'COMPLETED' },
      });

      if (claimed.count === 0) {
        return NextResponse.json(
          { error: 'Batch sudah tidak berstatus OPEN' },
          { status: 409 },
        );
      }

      return NextResponse.json({ batch: { id: batch.id, status: 'COMPLETED' } });
    }

    const result = editBatchSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const nextMaxQuota = result.data.maxQuota ?? batch.maxQuota;
    const nextMinQuota = result.data.minQuota ?? batch.minQuota;
    if (nextMinQuota > nextMaxQuota) {
      return NextResponse.json(
        { error: 'minQuota tidak boleh melebihi maxQuota', fieldErrors: { minQuota: ['minQuota tidak boleh melebihi maxQuota'] } },
        { status: 400 },
      );
    }

    const nextStartDate = result.data.startDate ? new Date(result.data.startDate) : batch.startDate;
    const nextEndDate = result.data.endDate ? new Date(result.data.endDate) : batch.endDate;
    const nextRegistrationDeadline = result.data.registrationDeadline
      ? new Date(result.data.registrationDeadline)
      : batch.registrationDeadline;

    if (nextEndDate < nextStartDate) {
      return NextResponse.json(
        { error: 'endDate tidak boleh sebelum startDate', fieldErrors: { endDate: ['endDate tidak boleh sebelum startDate'] } },
        { status: 400 },
      );
    }

    if (nextRegistrationDeadline > nextStartDate) {
      return NextResponse.json(
        {
          error: 'registrationDeadline tidak boleh setelah startDate',
          fieldErrors: { registrationDeadline: ['registrationDeadline tidak boleh setelah startDate'] },
        },
        { status: 400 },
      );
    }

    const data: Record<string, unknown> = { ...result.data };
    if (data.startDate) data.startDate = new Date(data.startDate as string);
    if (data.endDate) data.endDate = new Date(data.endDate as string);
    if (data.registrationDeadline) data.registrationDeadline = new Date(data.registrationDeadline as string);

    const updated = await prisma.volunteerBatch.update({
      where: { id: batch.id },
      data,
    });

    return NextResponse.json({ batch: updated });
  } catch (error) {
    console.error('Error updating volunteer batch:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
