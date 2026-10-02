import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { requestCampaignTransfer } from '@/lib/money/campaign-transfers';

/**
 * POST /api/admin/campaign-transfers: one Admin asks for a Suspended zakat or
 * wakaf Campaign's money to move to another Campaign of the same Kind
 * (CONTEXT.md, Campaign Transfer; PRD §7.2).
 *
 *   { sourceId, targetId, amount, reason }
 *
 * The route records and stops: a different Admin decides on
 * /api/admin/campaign-transfers/[id]/decision, so nothing moves on one
 * person's word. The Kind rules, the Suspension check and the balance check
 * are the service layer's, not this route's, so a hand-built request meets the
 * same refusals a screen would.
 *
 * ADMIN only, through the ADMIN assignment alone, like Manual Contribution.
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
    const transfer = await prisma.$transaction((tx) =>
      requestCampaignTransfer(tx, {
        sourceId: body.sourceId as string,
        targetId: body.targetId as string,
        amount: body.amount as number,
        reason: body.reason as string,
        requestedById: actorId,
      }),
    );
    return NextResponse.json({ transfer }, { status: 201 });
  } catch (error) {
    const refusal = domainErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});
