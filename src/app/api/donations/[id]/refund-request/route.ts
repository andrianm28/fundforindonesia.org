import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refusalResponse } from '@/lib/refusal-response';
import { requestDonorRefund } from '@/lib/money/donor-refunds';
import { DonorRefundNotEligibleError } from '@/lib/money/donor-refund-errors';

// Type-checked only: every limit on amount and reason is requestDonorRefund's own question.
const bodySchema = z.object({ amount: z.number(), reason: z.string() });

/**
 * POST /api/donations/[id]/refund-request -- a signed-in Donor asks for a
 * Refund of their own Donation (CONTEXT.md, Refund; PRD 7.2). Nothing is paid
 * out: it creates a Refund in REQUESTED that an Admin approves or rejects on
 * /admin/refunds. Every rule (ownership, window, cap per Kind, Payout, open
 * limit) is enforced in requestDonorRefund, not here.
 *
 * Somebody else's Donation and a guest Donation both answer 404, the same as
 * a Donation that does not exist.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }

  const { id } = await params;
  try {
    const refund = await requestDonorRefund(prisma, {
      donorId: session.user.id,
      donationId: id,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ id: refund.id, amount: refund.amount, status: refund.status }, { status: 201 });
  } catch (error) {
    if (error instanceof DonorRefundNotEligibleError && error.reason === 'NOT_OWNER') {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error requesting donor refund:', error);
    return NextResponse.json({ error: 'Gagal mengajukan Refund' }, { status: 500 });
  }
}
