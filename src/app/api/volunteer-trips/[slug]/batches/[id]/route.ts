import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { Role } from '@/generated/prisma/client';

const editBatchSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  registrationDeadline: z.string().datetime().optional(),
  maxQuota: z.number().int().positive().optional(),
  minQuota: z.number().int().positive().optional(),
});

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
