import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { duplicateHintsErrorToHttp, setDuplicateSimilarityThreshold } from '@/lib/duplicate-hints';

/**
 * POST /api/admin/duplicate-similarity: an Admin sets the title similarity
 * above which two Campaigns count as alike (PRD FFI-05: "ambang 0,6 diatur
 * Admin"; prd-compliance 14). Body is `{ threshold }`, a `similarity()` score
 * above 0 and at most 1 -- 0.75, not 75. Append-only insert
 * (src/lib/duplicate-hints.ts), so this route never edits an earlier row: the
 * value a hint was matched under stays readable, and the latest row is the one
 * in force.
 *
 * ADMIN only.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const session = await getServerSession();
  const actorId = session!.user.id as string;

  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }

  try {
    const threshold = await setDuplicateSimilarityThreshold(prisma, {
      threshold: (parsed as Record<string, unknown>).threshold as number,
      actorId,
    });
    return NextResponse.json({ threshold }, { status: 201 });
  } catch (error) {
    const refusal = duplicateHintsErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
});
