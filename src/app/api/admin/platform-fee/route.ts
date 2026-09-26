import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import {
  setPlatformFeeRule,
  setPlatformFeeThreshold,
  platformFeeErrorToHttp,
} from '@/lib/money/platform-fee-config';

/**
 * POST /api/admin/platform-fee: an Admin sets a new Platform Fee rate or a
 * new waiver threshold (CONTEXT.md, Platform Fee; prd-compliance 17). Both
 * writes are append-only inserts (src/lib/money/platform-fee-config.ts), so
 * this route never updates an existing row -- "who and when" is exactly
 * setById/setAt on the row it creates, and Donations already made keep the
 * rate they froze.
 *
 * Body is one of:
 *   { target: 'rule', scope: 'KIND', kind, percentBps }
 *   { target: 'rule', scope: 'CATEGORY', category, percentBps }
 *   { target: 'rule', scope: 'CAMPAIGN', campaignId, percentBps }
 *   { target: 'threshold', amount }
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
  const body = parsed as Record<string, unknown>;

  try {
    if (body.target === 'rule') {
      const rule = await setPlatformFeeRule(prisma, {
        scope: body.scope as never,
        kind: body.kind as never,
        category: body.category as string | undefined,
        campaignId: body.campaignId as string | undefined,
        percentBps: body.percentBps as number,
        actorId,
      });
      return NextResponse.json({ rule }, { status: 201 });
    }

    if (body.target === 'threshold') {
      const threshold = await setPlatformFeeThreshold(prisma, {
        amount: body.amount as number,
        actorId,
      });
      return NextResponse.json({ threshold }, { status: 201 });
    }

    return NextResponse.json(
      { error: "target harus 'rule' atau 'threshold'." },
      { status: 400 },
    );
  } catch (error) {
    const refusal = platformFeeErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
});
