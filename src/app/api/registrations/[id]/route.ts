import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import {
  createRefund,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
} from '@/lib/money/refunds';
import { tripFeeRefundAmount } from '@/lib/volunteer/refunds';

class RegistrationNotCancellableError extends Error {}

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
    const volunteerId = session.user.id as string;

    const registration = await prisma.registration.findUnique({
      where: { id },
      select: {
        id: true,
        volunteerId: true,
        status: true,
        batch: { select: { tripId: true, startDate: true } },
        payment: { select: { id: true, amount: true } },
      },
    });

    if (!registration) {
      return NextResponse.json({ error: 'Registrasi tidak ditemukan' }, { status: 404 });
    }

    if (registration.volunteerId !== volunteerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (registration.status !== 'HOLD' && registration.status !== 'CONFIRMED') {
      return NextResponse.json({ error: 'Registrasi tidak bisa dibatalkan pada status ini' }, { status: 400 });
    }

    try {
      // The status transition is claimed with a predicate-based update
      // INSIDE the same transaction that (for a CONFIRMED Registration)
      // creates the Refund -- so a concurrent second cancel attempt on
      // this same Registration can't also pass the read above and also
      // create a second Refund, and so a createRefund failure rolls the
      // status change back too rather than leaving a cancelled-but-
      // unrefunded Registration.
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.registration.updateMany({
          where: { id: registration.id, status: registration.status },
          data: { status: 'CANCELLED' },
        });
        if (claimed.count === 0) {
          throw new RegistrationNotCancellableError();
        }

        if (registration.status === 'HOLD') {
          return { refund: null as { id: string; amount: number; status: string } | null };
        }

        // A CONFIRMED Registration is only ever reached once its Payment
        // has settled (see prisma/schema.prisma's own comment on
        // Registration.status) -- payment is guaranteed non-null here.
        const payment = registration.payment!;
        const amount = tripFeeRefundAmount({
          departureDate: registration.batch.startDate,
          now: new Date(),
          paidAmount: payment.amount,
        });

        if (amount === 0) {
          return { refund: null };
        }

        const refund = await createRefund(tx, {
          subject: { type: 'trip', tripId: registration.batch.tripId },
          paymentId: payment.id,
          amount,
          reason: 'Volunteer membatalkan Registrasi',
          requestedById: volunteerId,
        });

        return { refund: { id: refund.id, amount: refund.amount, status: refund.status } };
      });

      return NextResponse.json({
        id: registration.id,
        status: 'CANCELLED',
        refund: result.refund,
      });
    } catch (error) {
      if (error instanceof RegistrationNotCancellableError) {
        return NextResponse.json({ error: 'Registrasi tidak bisa dibatalkan pada status ini' }, { status: 409 });
      }
      if (
        error instanceof PaymentNotFoundError ||
        error instanceof PaymentSubjectMismatchError ||
        error instanceof RefundExceedsRemainingError
      ) {
        console.error('Error cancelling registration -- refund could not be created:', error);
        return NextResponse.json({ error: 'Gagal membuat refund untuk pembatalan ini' }, { status: 500 });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error cancelling registration:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
