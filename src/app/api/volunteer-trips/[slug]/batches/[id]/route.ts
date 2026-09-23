import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
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

class MinQuotaMetError extends Error {}

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
    const isOwner = isAtLeast(userRole, 'CAMPAIGN_CREATOR') && trip.fundraiserId === session.user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
        // Locking the Batch row (via the CONFIRMED count read, serialized
        // through the transaction) before both checking minQuota and
        // creating every Refund means a Registration confirming
        // concurrently -- right as the Fundraiser cancels -- can't push
        // the count past minQuota while this cancel is mid-flight, and two
        // concurrent cancel attempts on the same Batch can't both pass the
        // guard and both bulk-refund.
        const result = await prisma.$transaction(async (tx) => {
          const confirmedCount = await tx.registration.count({
            where: { batchId: batch.id, status: 'CONFIRMED' },
          });
          if (confirmedCount >= batch.minQuota) {
            throw new MinQuotaMetError();
          }

          const cancelledBatch = await tx.volunteerBatch.update({
            where: { id: batch.id },
            data: { status: 'CANCELLED' },
          });

          const confirmedRegistrations = await tx.registration.findMany({
            where: { batchId: batch.id, status: 'CONFIRMED' },
            select: { id: true, payment: { select: { id: true, amount: true } } },
          });

          await tx.registration.updateMany({
            where: { batchId: batch.id, status: 'CONFIRMED' },
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
        throw error;
      }
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
