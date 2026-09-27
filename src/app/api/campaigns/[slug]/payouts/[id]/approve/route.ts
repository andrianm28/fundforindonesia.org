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
 *
 * The body carries the provider balance the Admin read in the provider's own
 * dashboard before approving, and which provider it was read from (FFI-07;
 * ADR 0006). Both are required: no provider this platform talks to exposes a
 * balance API, so this is the only place the real figure can come from, and an
 * approval that leaves it out has been checked against the Campaign's books
 * alone -- which say the Campaign is owed the money and say nothing about
 * whether the provider is holding it. approvePayout refuses one that is missing
 * and one that is short of the Payout's amount.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: any) => {
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

  // Read after the Payout has been located, so a request for a Payout that
  // does not exist still answers 404 rather than complaining about a missing
  // provider balance the caller was never going to be allowed to use.
  const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;

  try {
    // No payment provider is resolved here on purpose. Approval never
    // instructs a provider -- a second admin performs the withdrawal by hand
    // and marks the payout completed with proof. See ADR 0006 and the doc
    // comment on approvePayout.
    const updated = await approvePayout(prisma, {
      payoutId: id,
      approvedById,
      provider: typeof body?.provider === 'string' ? body.provider : '',
      providerBalance: body?.providerBalance as number,
    });

    return NextResponse.json({
      id: updated.id,
      campaignId: updated.campaignId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
      approvedAt: updated.approvedAt,
      approvedProvider: updated.approvedProvider,
      approvedProviderBalance: updated.approvedProviderBalance,
      providerRef: updated.providerRef,
    });
  } catch (error) {
    // Every refusal carries its own code and answers its own status. The
    // Bank Account refusal is genuinely reachable here: approvePayout
    // re-checks ownership and verifiedAt at approval time, since
    // verification can be revoked between request and approval. So are the two
    // provider-balance refusals, which are reachable on almost every request
    // that has not been through the dashboard first.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error approving payout:', error);
    return NextResponse.json({ error: 'Gagal menyetujui pencairan' }, { status: 500 });
  }
});
