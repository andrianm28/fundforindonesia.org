import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { requestPayoutRevision } from '@/lib/money/payouts';

/**
 * POST /api/admin/payouts/[id]/request-revision -- an Admin sends a DRAFT
 * Payout back to its Fundraiser with a reason (PKS Pasal 4.5; pks-pemenuhan/12).
 * Posts nothing: the Payout becomes REVISION_REQUESTED, cannot be approved
 * until the Fundraiser resubmits it, and the Fundraiser is told in the inbox
 * and by email.
 *
 * Under /api/admin/payouts/[id] like reject and balance-check: the money layer
 * finds the Campaign or Trip from the Payout row itself and locks it, so there
 * is no subject slug here. Anyone without ADMIN gets the literal 404 from
 * withHiddenAssignmentCheck. Every rule (status, the subject's own Fundraiser
 * refused as Admin, the reason) is the money layer's, answered through
 * refusalResponse: 409 (INVALID_PAYOUT_STATUS) for any other status or a lost
 * race, 400 (PAYOUT_REASON_INVALID) for a blank or long reason.
 */
export const POST = withHiddenAssignmentCheck(
  Assignment.ADMIN,
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const actorId = session!.user!.id as string;

    const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;

    try {
      const updated = await requestPayoutRevision(prisma, {
        payoutId: id,
        requestedById: actorId,
        reason: typeof body?.reason === 'string' ? body.reason : '',
      });

      return NextResponse.json({
        id: updated.id,
        amount: updated.amount,
        status: updated.status,
        revisionReason: updated.revisionReason,
      });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      console.error('Error requesting payout revision:', error);
      return NextResponse.json({ error: 'Gagal meminta revisi pencairan' }, { status: 500 });
    }
  },
);
