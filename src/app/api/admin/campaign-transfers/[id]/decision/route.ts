import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { approveCampaignTransfer, rejectCampaignTransfer } from '@/lib/money/campaign-transfers';

/**
 * POST /api/admin/campaign-transfers/[id]/decision: the second Admin's half of
 * a Campaign Transfer (CONTEXT.md, Campaign Transfer; PRD §7.2).
 *
 *   { decision: 'approve' }            -- the money moves, as one balanced journal
 *   { decision: 'reject', reason }     -- it never will
 *
 * `decision` is enumerated here rather than taken as a status to write, so a
 * request cannot ask for a state the service layer does not recognise. The
 * service layer owns the two-person rule, the Kind rules and the balance; the
 * route owns the ADMIN assignment and the HTTP shape.
 */
export const POST = withAssignmentCheck(
  Assignment.ADMIN,
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const actorId = session!.user.id as string;

    const parsed = await req.json().catch(() => undefined);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
    }
    const { decision, reason } = parsed as { decision?: unknown; reason?: unknown };

    try {
      if (decision === 'approve') {
        const transfer = await approveCampaignTransfer(prisma, { campaignTransferId: id, decidedById: actorId });
        return NextResponse.json({ transfer }, { status: 200 });
      }
      if (decision === 'reject') {
        const transfer = await rejectCampaignTransfer(prisma, {
          campaignTransferId: id,
          decidedById: actorId,
          reason: reason as string,
        });
        return NextResponse.json({ transfer }, { status: 200 });
      }
      return NextResponse.json({ error: "decision harus 'approve' atau 'reject'." }, { status: 400 });
    } catch (error) {
      const refusal = domainErrorToHttp(error);
      if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
      throw error;
    }
  },
);
