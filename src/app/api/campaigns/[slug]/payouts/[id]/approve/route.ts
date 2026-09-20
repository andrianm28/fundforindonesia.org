import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withRoleCheck } from '@/lib/withRoleCheck';
import {
  approvePayout,
  BankAccountNotEligibleError,
  InsufficientBalanceError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
  SelfApprovalError,
} from '@/lib/money/payouts';

/**
 * POST /api/campaigns/[slug]/payouts/[id]/approve -- ADMIN approves a DRAFT
 * payout and releases it in the same action.
 *
 * withRoleCheck('ADMIN') gates on role only and does not pass the session to
 * the handler, so getServerSession is called again here to learn who is
 * approving -- that identity is what the two-person check in
 * approvePayout compares against requestedById.
 */
export const POST = withRoleCheck('ADMIN', async (_request: NextRequest, context: any) => {
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
    if (error instanceof PayoutNotFoundError) {
      return NextResponse.json({ error: 'Payout tidak ditemukan' }, { status: 404 });
    }
    if (error instanceof SelfApprovalError) {
      return NextResponse.json(
        { error: 'Payout tidak dapat disetujui oleh orang yang mengajukannya' },
        { status: 403 },
      );
    }
    if (error instanceof InvalidPayoutStatusError) {
      return NextResponse.json(
        { error: 'Payout tidak lagi menunggu persetujuan' },
        { status: 409 },
      );
    }
    if (error instanceof InsufficientBalanceError) {
      return NextResponse.json(
        { error: 'Saldo campaign tidak lagi mencukupi untuk pencairan ini' },
        { status: 400 },
      );
    }
    if (error instanceof BankAccountNotEligibleError) {
      // Genuinely reachable: approvePayout re-checks ownership and
      // verifiedAt at approval time, not just at request time, because an
      // operator can revoke verification on a bank account discovered to be
      // fraudulent in the window between the two.
      return NextResponse.json(
        { error: 'Rekening tujuan tidak lagi memenuhi syarat' },
        { status: 403 },
      );
    }
    console.error('Error approving payout:', error);
    return NextResponse.json({ error: 'Gagal menyetujui pencairan' }, { status: 500 });
  }
});
