import type { PrismaClient } from '@/generated/prisma/client';
import { tripFeeRefundAmount } from './refunds';

/**
 * What a Volunteer sees of one of their own Registrations (ticket 36): its
 * status, the Trip and Batch, the Refunds on its Trip Fee, and the amount a
 * cancel would refund RIGHT NOW. Read-only; no status is written here.
 */
export type RegistrationView = {
  id: string;
  /** A HOLD whose window has passed reads EXPIRED, as the catalog counts it. */
  status: 'HOLD' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  holdExpiresAt: Date;
  trip: { slug: string; title: string; destination: string };
  batch: { startDate: Date; endDate: Date };
  tripFee: number;
  paidAmount: number | null;
  /** What cancelRegistration would refund as of `now`: 0 for a HOLD or inside the no-refund window. */
  cancelRefundAmount: number;
  refunds: { id: string; amount: number; status: string }[];
};

export async function getVolunteerRegistration(
  prisma: PrismaClient,
  params: { registrationId: string; userId: string; now: Date },
): Promise<RegistrationView | null> {
  const { registrationId, userId, now } = params;
  const r = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: {
      id: true,
      volunteerId: true,
      status: true,
      holdExpiresAt: true,
      batch: {
        select: {
          startDate: true,
          endDate: true,
          trip: { select: { slug: true, title: true, destination: true, tripFeeAmount: true } },
        },
      },
      payment: {
        select: {
          amount: true,
          status: true,
          refunds: { select: { id: true, amount: true, status: true }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  // Someone else's Registration is indistinguishable from a missing one.
  if (!r || r.volunteerId !== userId) return null;

  const status = r.status === 'HOLD' && r.holdExpiresAt <= now ? 'EXPIRED' : r.status;
  const paidAmount = r.payment && r.payment.status === 'PAID' ? r.payment.amount : null;
  const cancelRefundAmount =
    r.status === 'CONFIRMED' && paidAmount !== null
      ? tripFeeRefundAmount({ departureDate: r.batch.startDate, now, paidAmount })
      : 0;
  return {
    id: r.id,
    status,
    holdExpiresAt: r.holdExpiresAt,
    trip: { slug: r.batch.trip.slug, title: r.batch.trip.title, destination: r.batch.trip.destination },
    batch: { startDate: r.batch.startDate, endDate: r.batch.endDate },
    tripFee: r.batch.trip.tripFeeAmount,
    paidAmount,
    cancelRefundAmount,
    refunds: r.payment?.refunds ?? [],
  };
}
