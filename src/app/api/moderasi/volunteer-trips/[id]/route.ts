import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment, StatusChangeCapacity, VolunteerTripStatus } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { prisma } from '@/lib/prisma';
import { OwnTripConflictError } from '@/lib/subject-guard';
import { TripNotSubmittedError } from '@/lib/volunteer-trip-errors';
import { NextRequest, NextResponse } from 'next/server';

const VALID_ACTIONS = ['approve', 'reject'] as const;
type ModerationAction = (typeof VALID_ACTIONS)[number];

const ACTION_STATUS_MAP: Record<ModerationAction, 'ACTIVE' | 'REJECTED'> = {
  approve: 'ACTIVE',
  reject: 'REJECTED',
};

const ACTION_MESSAGE_MAP: Record<ModerationAction, string> = {
  approve: 'Volunteer Trip Anda telah disetujui dan kini aktif',
  reject: 'Volunteer Trip Anda ditolak',
};

function refuse(error: OwnTripConflictError | TripNotSubmittedError) {
  const refusal = domainErrorToHttp(error)!;
  return NextResponse.json(refusal.body, { status: refusal.status });
}

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
    select: { id: true, fundraiserId: true, title: true, status: true },
  });

  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }

  // A Verifier never acts as Verifier on a Trip they own (CONTEXT.md,
  // Verifier; ADR 0005): another Verifier must judge it.
  const session = await getServerSession();
  if (trip.fundraiserId === session?.user?.id) {
    return refuse(new OwnTripConflictError(StatusChangeCapacity.VERIFIER));
  }

  // A Verifier decides only a Submitted Trip (mirroring Campaign
  // moderation, decideSubmission). The write is predicated on SUBMITTED too,
  // so of two Verifiers deciding at once only the first changes it.
  if (trip.status !== VolunteerTripStatus.SUBMITTED) {
    return refuse(new TripNotSubmittedError(trip.status));
  }

  const validAction = action as ModerationAction;
  const newStatus = ACTION_STATUS_MAP[validAction];

  const written = await prisma.volunteerTrip.updateMany({
    where: { id, status: VolunteerTripStatus.SUBMITTED },
    data: { status: newStatus },
  });
  if (written.count === 0) {
    return refuse(new TripNotSubmittedError(trip.status));
  }

  const updatedTrip = (await prisma.volunteerTrip.findUnique({ where: { id } }))!;

  await prisma.notification.create({
    data: {
      type: 'volunteer_trip_moderation',
      title: 'Volunteer Trip Moderation Update',
      message: ACTION_MESSAGE_MAP[validAction],
      userId: trip.fundraiserId,
      link: `/volunteer-trip/${updatedTrip.slug}`,
    },
  });

  return NextResponse.json({ trip: updatedTrip });
});
