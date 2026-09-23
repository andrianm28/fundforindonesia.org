import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const GET = withAssignmentCheck(Assignment.VERIFIER, async (_req: NextRequest) => {
  const trips = await prisma.volunteerTrip.findMany({
    where: { status: 'SUBMITTED' },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ trips });
});
