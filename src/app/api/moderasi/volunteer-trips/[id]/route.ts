import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment, StatusChangeCapacity, VolunteerTripStatus } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { refusalResponse } from '@/lib/refusal-response';
import { judgeCapacity } from '@/lib/capacity';
import { TripNotSubmittedError } from '@/lib/volunteer-trip-errors';
import { NextRequest, NextResponse } from 'next/server';

const VALID_ACTIONS = ['approve', 'reject'] as const;
type ModerationAction = (typeof VALID_ACTIONS)[number];

const ACTION_STATUS_MAP: Record<ModerationAction, 'ACTIVE' | 'REJECTED'> = {
  approve: 'ACTIVE',
  reject: 'REJECTED',
};

const ACTION_NOTIFICATION_MAP: Record<ModerationAction, { title: string; message: string }> = {
  approve: { title: 'Volunteer Trip Disetujui', message: 'Volunteer Trip Anda telah disetujui dan kini aktif' },
  reject: { title: 'Volunteer Trip Ditolak', message: 'Volunteer Trip Anda ditolak' },
};

export const PATCH = withAssignmentCheck(Assignment.VERIFIER, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { action } = body;

  if (!action || !VALID_ACTIONS.includes(action as ModerationAction)) {
    return NextResponse.json(
      { error: 'Invalid action. Must be one of: approve, reject' },
      { status: 400 },
    );
  }

  const trip = await prisma.volunteerTrip.findUnique({
    where: { id },
    select: { id: true, fundraiserId: true, title: true, slug: true, status: true },
  });

  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }

  // A Verifier never acts as Verifier on a Trip they own (CONTEXT.md,
  // Capacity; ADR 0005): another Verifier must judge it.
  const session = await getServerSession();
  try {
    judgeCapacity(
      { kind: 'trip', ownerId: trip.fundraiserId },
      { userId: session?.user?.id ?? '', assignments: session?.user?.assignments ?? [] },
      StatusChangeCapacity.VERIFIER,
    );
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }

  // A Verifier decides only a Submitted Trip, as with a Campaign
  // (decideSubmission). The write is predicated on SUBMITTED too, so of two
  // Verifiers deciding at once only the first changes it; the other gets the
  // same refusal. Status and notification commit together or not at all.
  if (trip.status !== VolunteerTripStatus.SUBMITTED) {
    return refusalResponse(new TripNotSubmittedError())!;
  }

  const validAction = action as ModerationAction;
  const newStatus = ACTION_STATUS_MAP[validAction];

  const written = await prisma.$transaction(async (tx) => {
    const { count } = await tx.volunteerTrip.updateMany({
      where: { id, status: VolunteerTripStatus.SUBMITTED },
      data: { status: newStatus },
    });
    if (count === 0) return false;
    await tx.notification.create({
      data: {
        type: 'volunteer_trip_moderation',
        ...ACTION_NOTIFICATION_MAP[validAction],
        userId: trip.fundraiserId,
        link: `/volunteer-trip/${trip.slug}`,
      },
    });
    return true;
  });
  if (!written) {
    return refusalResponse(new TripNotSubmittedError())!;
  }

  return NextResponse.json({ trip: { ...trip, status: newStatus } });
});
