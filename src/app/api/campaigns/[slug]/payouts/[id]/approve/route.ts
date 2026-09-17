import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withRoleCheck } from '@/lib/withRoleCheck';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';
import {
  approveAndReleasePayout,
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
 * approveAndReleasePayout compares against requestedById.
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

  // Resolved before touching the transaction, the same way donations and the
  // webhook do it: if the provider is not configured, nothing about this
  // payout is touched -- this is an outage, not a decision to reject it.
  let provider;
  try {
    provider = getPaymentProvider();
  } catch (err) {
    if (err instanceof PaymentProviderNotConfiguredError) {
      return NextResponse.json(
        { error: 'Payment provider tidak dikonfigurasi' },
        { status: 503 },
      );
    }
    throw err;
  }

  try {
    const updated = await prisma.$transaction((tx) =>
      approveAndReleasePayout(tx, { payoutId: id, approvedById, provider }),
    );

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
      // Not reachable today -- requestPayout already enforced this at
      // creation time, and nothing between request and approval can change a
      // BankAccount's owner or verifiedAt. Handled anyway so an approve
      // response never falls through to a bare 500 for a case the type
      // system cannot rule out.
      return NextResponse.json(
        { error: 'Rekening tujuan tidak lagi memenuhi syarat' },
        { status: 403 },
      );
    }
    console.error('Error approving payout:', error);
    return NextResponse.json({ error: 'Gagal menyetujui pencairan' }, { status: 500 });
  }
});
