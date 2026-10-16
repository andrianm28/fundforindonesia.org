import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { proposeLateSettlementRefund } from '@/lib/money/campaign-refund-proposals';

/**
 * POST /api/admin/refunds/late-settlements: one Admin proposes the Refund for
 * one Payment on the worklist "Dana masuk setelah Campaign ditutup" (PRD 7.2;
 * ticket rilis-1-benda/80).
 *
 *   { paymentId }
 *
 * The amount is always the Payment's Gross and the requester is the calling
 * Admin, through the existing `createRefund`, so the three-Admin rule is
 * untouched. The server re-derives that the Payment is on the worklist; a
 * stale page gets 409, not a second Refund.
 *
 * ADMIN only; anyone else gets 404.
 */
export const POST = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const session = await getServerSession();
  const actorAdminId = session!.user!.id as string;

  const body = await req.json().catch(() => null);
  const paymentId = body && typeof body === 'object' ? (body as Record<string, unknown>).paymentId : undefined;
  if (typeof paymentId !== 'string' || paymentId === '') {
    return NextResponse.json({ error: 'Payment harus dipilih' }, { status: 400 });
  }

  try {
    const refund = await proposeLateSettlementRefund(prisma, { paymentId, actorAdminId });
    return NextResponse.json(
      { id: refund.id, paymentId: refund.paymentId, amount: refund.amount, status: refund.status },
      { status: 201 },
    );
  } catch (error) {
    const refusal = domainErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});
