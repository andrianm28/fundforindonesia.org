import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import {
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
} from '@/lib/money/refunds';
import { refusalResponse } from '@/lib/refusal-response';
import { cancelRegistration } from '@/lib/volunteer/trip';

/**
 * A Volunteer cancels their own Registration: `cancelRegistration` in the
 * Volunteer Trip module decides, and refunds a paid one by the Trip Fee
 * Refund policy's tier. Its refusals answer through `domainErrorToHttp`.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { registration, refund } = await cancelRegistration(prisma, {
      registrationId: id,
      actor: { userId: session.user.id as string },
    });

    return NextResponse.json({
      id: registration.id,
      status: registration.status,
      refund: refund && { id: refund.id, amount: refund.amount, status: refund.status },
    });
  } catch (error) {
    // The Refund could not be created for a Payment the cancel itself found:
    // an inconsistency in stored data, not the Volunteer's mistake, so a
    // 500 rather than the refusal's own status. Nothing was cancelled.
    if (
      error instanceof PaymentNotFoundError ||
      error instanceof PaymentSubjectMismatchError ||
      error instanceof RefundExceedsRemainingError
    ) {
      console.error('Error cancelling registration -- refund could not be created:', error);
      return NextResponse.json({ error: 'Gagal membuat refund untuk pembatalan ini' }, { status: 500 });
    }
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error cancelling registration:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
