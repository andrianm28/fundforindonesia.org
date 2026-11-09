import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { hasAssignment } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { operationsErrorToHttp, resolveOperations, setOperations } from '@/lib/operations';

/**
 * Setelan operasional (src/lib/operations.ts): the donation switch and the
 * maintenance mode, changed by an Admin without a rebuild.
 *
 * GET   the switches in force and their change history.
 * POST  body `{ donationsOpen?, maintenanceOn?, maintenanceMessage? }`; any
 *       subset, validated in the module. Every change is recorded (who, when,
 *       old and new value).
 *
 * ADMIN only, for reading as well as changing. Anyone else -- signed in or
 * not -- gets the same 404 as a route that does not exist (owner's decision,
 * ticket 90), so the setting's existence is not revealed.
 */
async function adminOrNull() {
  const session = await getServerSession();
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.ADMIN)) return null;
  return session.user;
}

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function GET() {
  if (!(await adminOrNull())) return NOT_FOUND();
  return NextResponse.json({ operations: await resolveOperations(prisma) });
}

export async function POST(req: NextRequest) {
  const admin = await adminOrNull();
  if (!admin) return NOT_FOUND();

  const patch = await req.json().catch(() => undefined);
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }

  try {
    const operations = await setOperations(prisma, {
      patch,
      actorId: admin.id as string,
      actorName: admin.name ?? admin.email ?? 'Admin',
    });
    return NextResponse.json({ operations }, { status: 200 });
  } catch (error) {
    const refusal = operationsErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
