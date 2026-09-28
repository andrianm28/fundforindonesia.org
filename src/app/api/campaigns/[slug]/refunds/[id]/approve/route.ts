import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { approveRefund } from '@/lib/money/refunds';

const approveRefundSchema = z.object({
  // Type-checked only, exactly like completeRefundSchema: whether a field is
  // blank, whitespace-only or over length is approveRefund's own question,
  // asked through the same cleanDestinationText the Admin's form asks
  // before submitting (Q7(c), ADR 0018 Amendment 2026-09-28).
  donorBankCode: z.string(),
  donorAccountName: z.string(),
  donorAccountNumber: z.string(),
});

/**
 * PATCH /api/campaigns/[slug]/refunds/[id]/approve -- a different Admin
 * approves a REQUESTED Refund, records the Donor destination from their
 * written request, and posts the settlement in the same action.
 *
 * Q7(c) (ADR 0018 Amendment 2026-09-28): the destination moved here from
 * completion -- an approval with no destination is refused
 * (REFUND_DESTINATION_INVALID) -- because this Admin is the first of the
 * two pairs of eyes Rilis 1 uses in place of a Verifier check.
 */
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = approveRefundSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const refund = await prisma.refund.findUnique({
    where: { id },
    select: { payment: { select: { donation: { select: { campaignId: true } } } } },
  });
  if (!refund || refund.payment.donation?.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Refund tidak ditemukan' }, { status: 404 });
  }

  try {
    const updated = await approveRefund(prisma, {
      refundId: id,
      approvedById,
      donorBankCode: parsed.data.donorBankCode,
      donorAccountName: parsed.data.donorAccountName,
      donorAccountNumber: parsed.data.donorAccountNumber,
    });

    return NextResponse.json({
      id: updated.id,
      paymentId: updated.paymentId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
    });
  } catch (error) {
    // Every refusal carries its own code and answers its own status.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error approving refund:', error);
    return NextResponse.json({ error: 'Gagal menyetujui refund' }, { status: 500 });
  }
});
