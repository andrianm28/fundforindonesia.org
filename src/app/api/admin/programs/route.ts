import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { createProgram, parseSector, programErrorToHttp, type ProgramCreateInput } from '@/lib/programs';

/**
 * The Admin's Program list (ticket 78; CONTEXT.md, Program). ADMIN only, and
 * anyone else gets the 404 of a route that does not exist (ticket 90).
 *
 *   GET  [?sector=] -> { programs: [...] }, newest first. An unknown Sector is
 *        400, not an empty list.
 *   POST { ...fields } -> 201 { program }. Every rule is src/lib/programs.ts's;
 *        its refusals are 400 with their Indonesian message.
 *
 * A Program takes no money online, so nothing here touches a ledger.
 */
export const GET = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const asked = new URL(req.url).searchParams.get('sector');
  const narrowed = asked !== null && asked !== '';
  const sector = narrowed ? parseSector(asked) : null;
  if (narrowed && sector === null) {
    return NextResponse.json({ error: 'Sektor Program tidak dikenal.' }, { status: 400 });
  }

  const programs = await prisma.program.findMany({
    where: sector === null ? {} : { sector },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ programs });
});

export const POST = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const body = await req.json().catch(() => undefined);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }

  try {
    const program = await createProgram(prisma, body as ProgramCreateInput);
    return NextResponse.json({ program }, { status: 201 });
  } catch (error) {
    const refusal = programErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
});
