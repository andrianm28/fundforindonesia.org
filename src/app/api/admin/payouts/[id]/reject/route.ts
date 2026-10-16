import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { rejectPayout } from '@/lib/money/payouts';

/**
 * POST /api/admin/payouts/[id]/reject -- an Admin rejects a DRAFT Payout with a reason (PAY-02).
 * Posts nothing; the way out for a leftover beta Payout at go-live (runbook beta-ke-live).
 *
 * Lives under /api/admin/payouts/[id] like balance-check: rejectPayout finds the
 * Campaign or Trip from the Payout row itself and locks it, so there is no
 * subject slug to resolve here. Every rule (status, the Fundraiser of the
 * subject refused as Admin, the reason) is the money layer's, answered
 * through refusalResponse: 409 (INVALID_PAYOUT_STATUS) for any other status
 * or a lost race, 400 (PAYOUT_REASON_INVALID) for a blank or long reason.
 */
export const POST = withHiddenAssignmentCheck(
  Assignment.ADMIN,
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const actorId = session!.user!.id as string;

    const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;

    try {
      const updated = await rejectPayout(prisma, {
        payoutId: id,
        rejectedById: actorId,
        reason: typeof body?.reason === 'string' ? body.reason : '',
      });

      return NextResponse.json({
        id: updated.id,
        amount: updated.amount,
        status: updated.status,
        rejectionReason: updated.rejectionReason,
      });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      console.error('Error rejecting payout:', error);
      return NextResponse.json({ error: 'Gagal menolak pencairan' }, { status: 500 });
    }
  },
);
