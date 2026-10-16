import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { refusalResponse } from '@/lib/refusal-response';
import { liftTripSuspension, suspendTrip } from '@/lib/volunteer/trip';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';

/**
 * Suspension of a Volunteer Trip as a resource, like a Campaign's
 * (src/app/api/campaigns/[slug]/suspension/route.ts): POST imposes it,
 * DELETE lifts it. Both take `{ reason }`. Who may (Admin only, never on
 * their own Trip, never the Admin who imposed it for a lift), the status
 * rules, the log and the Fundraiser's notification are suspendTrip's and
 * liftTripSuspension's (src/lib/volunteer/trip.ts); this route only maps.
 * Authority is the module's, as in the lifecycle adapter, not a route
 * wrapper's, because "never Admin on your own Trip" is not a single
 * assignment check.
 */
type RouteContext = { params: Promise<{ id: string }> };

async function readReason(req: NextRequest): Promise<unknown> {
  const body: unknown = await req.json().catch(() => null);
  return typeof body === 'object' && body !== null ? (body as { reason?: unknown }).reason : undefined;
}

function handle(command: typeof suspendTrip | typeof liftTripSuspension) {
  return async (req: NextRequest, context: RouteContext): Promise<NextResponse> => {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Anda harus login terlebih dahulu.', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    try {
      const { id } = await context.params;
      const { trip } = await command(prisma, {
        tripId: id,
        actor: { userId: session.user.id, assignments: session.user.assignments ?? [] },
        reason: await readReason(req),
      });
      return NextResponse.json({ trip });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      console.error(`Trip suspension ${req.method} ${req.nextUrl.pathname} failed:`, error);
      return NextResponse.json({ error: 'Terjadi kesalahan pada server.', code: 'INTERNAL_ERROR' }, { status: 500 });
    }
  };
}

// Anyone without the ADMIN assignment gets the Admin APIs' 404 before the Trip
// is looked up (ticket 90), so a Trip id is not confirmed to exist. Who may
// suspend or lift (never on your own Trip, never the imposing Admin's lift)
// stays the module's.
export const POST = withHiddenAssignmentCheck(Assignment.ADMIN, handle(suspendTrip));
export const DELETE = withHiddenAssignmentCheck(Assignment.ADMIN, handle(liftTripSuspension));
