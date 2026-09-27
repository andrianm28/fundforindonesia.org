import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { domainErrorToHttp } from '@/lib/domain-errors';
import {
  approveManualContribution,
  rejectManualContribution,
  reverseManualContribution,
} from '@/lib/money/manual-contributions';

/**
 * POST /api/admin/manual-contributions/[id]/decision: the second Admin's half
 * of a Manual Contribution (CONTEXT.md, Manual Contribution; PRD FFI-07c).
 *
 *   { decision: 'approve' }                  -- the money enters the books
 *   { decision: 'reject',  reason }          -- it never will
 *   { decision: 'reverse', reason }          -- it did, and is taken back out
 *
 * `decision` is enumerated here rather than taken as a status to write, so a
 * request cannot ask for a state the service layer does not recognise, and so
 * that a fourth verb -- "delete" -- has nowhere to land. The service layer
 * owns the two-person rule, the balance the reversal needs, and the rule that
 * a Campaign's own Fundraiser may do none of this; the route owns nothing but
 * the ADMIN assignment and the HTTP shape.
 *
 * ADMIN only.
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
        const contribution = await approveManualContribution(prisma, {
          manualContributionId: id,
          decidedById: actorId,
        });
        return NextResponse.json({ contribution }, { status: 200 });
      }

      if (decision === 'reject') {
        const contribution = await rejectManualContribution(prisma, {
          manualContributionId: id,
          decidedById: actorId,
          reason: reason as string,
        });
        return NextResponse.json({ contribution }, { status: 200 });
      }

      if (decision === 'reverse') {
        const contribution = await reverseManualContribution(prisma, {
          manualContributionId: id,
          reversedById: actorId,
          reason: reason as string,
        });
        return NextResponse.json({ contribution }, { status: 200 });
      }

      return NextResponse.json(
        { error: "decision harus 'approve', 'reject', atau 'reverse'." },
        { status: 400 },
      );
    } catch (error) {
      const refusal = domainErrorToHttp(error);
      if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
      throw error;
    }
  },
);
