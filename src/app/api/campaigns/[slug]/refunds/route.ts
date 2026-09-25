import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { createRefund } from '@/lib/money/refunds';

const createRefundSchema = z.object({
  paymentId: z.string().min(1, 'Payment harus dipilih'),
  amount: z.number().int('Jumlah harus berupa bilangan bulat').min(1, 'Jumlah refund harus lebih dari 0'),
  reason: z.string().min(1, 'Alasan harus diisi').max(500, 'Alasan maksimal 500 karakter'),
});

/**
 * POST /api/campaigns/[slug]/refunds -- an Admin creates a Refund on behalf
 * of a Donor who cannot self-initiate one through the interface (PRD
 * ยง7.2). Admin-only on both ends, unlike Payout's Fundraiser-request +
 * Admin-approve shape.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: any) => {
  const { slug } = await context.params;
  const session = await getServerSession();
  const requestedById = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = createRefundSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }
  const { paymentId, amount, reason } = parsed.data;

  const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, donation: { select: { campaignId: true } } } });
  if (!payment || payment.donation?.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Payment tidak ditemukan untuk campaign ini' }, { status: 404 });
  }

  try {
    const refund = await prisma.$transaction((tx) =>
      createRefund(tx, {
        subject: { type: 'campaign', campaignId: campaign.id },
        paymentId,
        amount,
        reason,
        requestedById,
      }),
    );

    return NextResponse.json(
      {
        id: refund.id,
        paymentId: refund.paymentId,
        amount: refund.amount,
        reason: refund.reason,
        status: refund.status,
        createdAt: refund.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    // Every refusal carries its own code; domainErrorToHttp owns the status
    // and body.
    const refusal = domainErrorToHttp(error);
    if (refusal) {
      return NextResponse.json(refusal.body, { status: refusal.status });
    }
    console.error('Error creating refund:', error);
    return NextResponse.json({ error: 'Gagal membuat refund' }, { status: 500 });
  }
});
