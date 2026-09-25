import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { approvePayout } from '@/lib/money/payouts';

/**
 * POST /api/campaigns/[slug]/payouts/[id]/approve -- an Admin approves a
 * DRAFT payout and releases it in the same action.
 *
 * withAssignmentCheck(Assignment.ADMIN) gates on the assignment only and
 * does not pass the session to the handler, so getServerSession is called
 * again here to learn who is approving -- that identity is what the
 * two-person check in approvePayout compares against requestedById.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (_request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const payout = await prisma.payout.findUnique({ where: { id }, select: { campaignId: true } });
  if (!payout || payout.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Payout tidak ditemukan' }, { status: 404 });
  }

  try {
    // No payment provider is resolved here on purpose. Approval never
    // instructs a provider -- a second admin performs the withdrawal by hand
    // and marks the payout completed with proof. See ADR 0006 and the doc
    // comment on approvePayout.
    const updated = await approvePayout(prisma, { payoutId: id, approvedById });

    return NextResponse.json({
      id: updated.id,
      campaignId: updated.campaignId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
      approvedAt: updated.approvedAt,
      providerRef: updated.providerRef,
    });
  } catch (error) {
    // Every refusal carries its own code and answers its own status. The
    // Bank Account refusal is genuinely reachable here: approvePayout
    // re-checks ownership and verifiedAt at approval time, since
    // verification can be revoked between request and approval.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error approving payout:', error);
    return NextResponse.json({ error: 'Gagal menyetujui pencairan' }, { status: 500 });
  }
});
