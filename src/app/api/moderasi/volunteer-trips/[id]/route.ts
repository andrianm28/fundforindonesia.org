import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

const VALID_ACTIONS = ['approve', 'reject'] as const;
type ModerationAction = (typeof VALID_ACTIONS)[number];

const ACTION_STATUS_MAP: Record<ModerationAction, 'ACTIVE' | 'REJECTED'> = {
  approve: 'ACTIVE',
  reject: 'REJECTED',
};

const ACTION_MESSAGE_MAP: Record<ModerationAction, string> = {
  approve: 'Volunteer Trip Anda telah disetujui dan kini aktif',
  reject: 'Volunteer Trip Anda ditolak oleh moderator',
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
    select: { id: true, fundraiserId: true, title: true },
  });

  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }

  const validAction = action as ModerationAction;
  const newStatus = ACTION_STATUS_MAP[validAction];

  const updatedTrip = await prisma.volunteerTrip.update({
    where: { id },
    data: { status: newStatus },
  });

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
