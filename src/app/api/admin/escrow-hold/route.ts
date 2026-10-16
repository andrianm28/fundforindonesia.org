import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { hasAssignment } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { setEscrowHoldSetting, escrowHoldErrorToHttp } from '@/lib/money/escrow-hold-config';

/**
 * POST /api/admin/escrow-hold: an Admin sets a new Escrow Hold length
 * (CONTEXT.md, Escrow Hold; PRD FFI-17; ticket 90). The write is an
 * append-only insert (src/lib/money/escrow-hold-config.ts), so this route
 * never updates a row -- "who and when" is setById/setAt on the row it
 * creates, and Payments already created keep the length they froze.
 *
 * Body is one of:
 *   { scope: 'DEFAULT', days }
 *   { scope: 'CATEGORY', category, days }
 *
 * ADMIN only, and anyone else -- signed in or not -- gets the same 404 as a
 * route that does not exist (ticket 90), so the setting's existence is not
 * revealed. withAssignmentCheck's 401/403 would say otherwise.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.ADMIN)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const actorId = session.user.id as string;

  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;

  try {
    const setting = await setEscrowHoldSetting(prisma, {
      scope: body.scope as never,
      category: typeof body.category === 'string' ? body.category : undefined,
      days: body.days as number,
      actorId,
    });
    return NextResponse.json({ setting }, { status: 201 });
  } catch (error) {
    const refusal = escrowHoldErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
