import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { programErrorToHttp, updateProgram, type ProgramUpdateInput } from '@/lib/programs';

type Context = { params: Promise<{ id: string }> };

/**
 * One Program for the Admin (ticket 78). ADMIN only; anyone else gets 404
 * (ticket 90).
 *
 *   GET   -> 200 { program }; 404 for an id no Program has.
 *   PATCH { ...fields } -> 200 { program }. Every field optional, at least one
 *         change required; the module's refusals are 400, an unknown id 404.
 */
export const GET = withHiddenAssignmentCheck(Assignment.ADMIN, async (_req: NextRequest, context?: Context) => {
  const { id } = await context!.params;
  const program = await prisma.program.findUnique({ where: { id } });
  if (!program) return NextResponse.json({ error: 'Program tidak ditemukan.' }, { status: 404 });
  return NextResponse.json({ program });
});

export const PATCH = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context?: Context) => {
  const { id } = await context!.params;
  const body = await req.json().catch(() => undefined);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }

  try {
    const program = await updateProgram(prisma, { programId: id, changes: body as ProgramUpdateInput });
    return NextResponse.json({ program });
  } catch (error) {
    const refusal = programErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
});
