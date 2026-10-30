import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { failPayout } from '@/lib/money/payouts';

/**
 * POST /api/admin/payouts/[id]/fail -- an Admin marks an APPROVED Payout failed
 * (transfer refused or never made, PAY-02). The instructed money returns to the
 * subject's balance as the exact mirror journal.
 *
 * Lives under /api/admin/payouts/[id] like balance-check: failPayout finds the
 * Campaign or Trip from the Payout row itself and locks it, so there is no
 * subject slug to resolve here. Every rule (status, the Fundraiser of the
 * subject refused as Admin, the reason) is the money layer's, answered
 * through refusalResponse: 409 (INVALID_PAYOUT_STATUS) for any other status
 * or a lost race, 403 (TWO_PERSON_RULE) when the actor is the Admin who
 * approved the Payout (owner, 2026-10-29), 400 (PAYOUT_REASON_INVALID) for a blank or long reason.
 */
export const POST = withHiddenAssignmentCheck(
  Assignment.ADMIN,
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const actorId = session!.user!.id as string;

    const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;

    try {
      const updated = await failPayout(prisma, {
        payoutId: id,
        failedById: actorId,
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
      console.error('Error failing payout:', error);
      return NextResponse.json({ error: 'Gagal menandai pencairan gagal' }, { status: 500 });
    }
  },
);
