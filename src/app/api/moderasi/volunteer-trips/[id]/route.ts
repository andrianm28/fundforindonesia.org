import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { refusalResponse } from '@/lib/refusal-response';
import { decideTripSubmission, isTripSubmissionDecision } from '@/lib/volunteer/trip';
import { NextRequest, NextResponse } from 'next/server';

/**
 * A Verifier approves or rejects a Submitted Volunteer Trip: `{ action, reason }`, the reason required on a reject.
 * The rules (Submitted only, never on a Trip the Verifier owns, the log and
 * the Fundraiser's notification) are decideTripSubmission's
 * (src/lib/volunteer/trip.ts); this route calls it and maps the result.
 */
export const PATCH = withAssignmentCheck(Assignment.VERIFIER, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const { action, reason } = await req.json();

  if (!isTripSubmissionDecision(action)) {
    return NextResponse.json(
      { error: 'Invalid action. Must be one of: approve, reject' },
      { status: 400 },
    );
  }

  const session = await getServerSession();
  try {
    const { trip } = await decideTripSubmission(prisma, {
      tripId: id,
      actor: { userId: session?.user?.id ?? '', assignments: session?.user?.assignments ?? [] },
      decision: action,
      reason,
    });
    return NextResponse.json({ trip });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }
});
