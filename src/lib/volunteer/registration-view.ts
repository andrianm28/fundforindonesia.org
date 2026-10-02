import type { PrismaClient } from '@/generated/prisma/client';
import { tripFeeRefundAmount } from './refunds';
import { safePaymentLink } from '@/lib/payments/payment-link';

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
  /**
   * How to finish paying a live HOLD ("Lanjutkan pembayaran"), from the
   * instructions stored on its Payment; null whenever there is nothing to
   * resume (not a live HOLD, no stored instructions, Payment expired or not
   * pending).
   */
  paymentInstructions: { redirectUrl: string | null; vaNumber: string | null } | null;
  /** The public Sertifikat Keikutsertaan code, once issued. */
  certificateCode: string | null;
};

const REGISTRATION_SELECT = {
  id: true,
  volunteerId: true,
  status: true,
  holdExpiresAt: true,
  attended: true,
  certificate: { select: { code: true } },
  batch: {
    select: {
      status: true,
      startDate: true,
      endDate: true,
      trip: { select: { slug: true, title: true, destination: true, tripFeeAmount: true } },
    },
  },
  payment: {
    select: {
      amount: true,
      status: true,
      expiresAt: true,
      redirectUrl: true,
      vaNumber: true,
      refunds: { select: { id: true, amount: true, status: true }, orderBy: { createdAt: 'asc' as const } },
    },
  },
} as const;

type RegistrationRowForView = {
  id: string;
  status: string;
  holdExpiresAt: Date;
  certificate: { code: string } | null;
  batch: {
    startDate: Date;
    endDate: Date;
    trip: { slug: string; title: string; destination: string; tripFeeAmount: number };
  };
  payment: {
    amount: number;
    status: string;
    expiresAt: Date | null;
    redirectUrl: string | null;
    vaNumber: string | null;
    refunds: { id: string; amount: number; status: string }[];
  } | null;
};

function toView(r: RegistrationRowForView, now: Date): RegistrationView {
  const status = (r.status === 'HOLD' && r.holdExpiresAt <= now ? 'EXPIRED' : r.status) as RegistrationView['status'];
  const paidAmount = r.payment && r.payment.status === 'PAID' ? r.payment.amount : null;
  const cancelRefundAmount =
    r.status === 'CONFIRMED' && paidAmount !== null
      ? tripFeeRefundAmount({ departureDate: r.batch.startDate, now, paidAmount })
      : 0;

  const payment = r.payment;
  const resumable =
    status === 'HOLD' &&
    payment !== null &&
    payment.status === 'PENDING' &&
    (payment.expiresAt === null || payment.expiresAt > now);
  const redirectUrl = resumable ? safePaymentLink(payment.redirectUrl) : null;
  const vaNumber = resumable ? payment.vaNumber : null;

  return {
    id: r.id,
    status,
    holdExpiresAt: r.holdExpiresAt,
    trip: { slug: r.batch.trip.slug, title: r.batch.trip.title, destination: r.batch.trip.destination },
    batch: { startDate: r.batch.startDate, endDate: r.batch.endDate },
    tripFee: r.batch.trip.tripFeeAmount,
    paidAmount,
    cancelRefundAmount,
    refunds: payment?.refunds ?? [],
    paymentInstructions: redirectUrl || vaNumber ? { redirectUrl, vaNumber } : null,
    certificateCode: r.certificate?.code ?? null,
  };
}

export async function getVolunteerRegistration(
  prisma: PrismaClient,
  params: { registrationId: string; userId: string; now: Date },
): Promise<RegistrationView | null> {
  const { registrationId, userId, now } = params;
  const r = await prisma.registration.findUnique({ where: { id: registrationId }, select: REGISTRATION_SELECT });
  // Someone else's Registration is indistinguishable from a missing one.
  if (!r || r.volunteerId !== userId) return null;
  return toView(r, now);
}

/** A Trip the Volunteer took part in, for "Catatan kontribusi": no impact figures, there is no source for them. */
export type CompletedTrip = { registrationId: string; title: string; destination: string; startDate: Date; endDate: Date };

/**
 * The signed-in Volunteer's dashboard (ticket 37): every Registration of
 * theirs, newest first, plus the Trips they completed (attended a CONFIRMED
 * Registration on a COMPLETED Batch). Scoped by `volunteerId` in the query.
 */
export async function listVolunteerRegistrations(
  prisma: PrismaClient,
  params: { userId: string; now: Date },
): Promise<{ registrations: RegistrationView[]; completed: CompletedTrip[] }> {
  const { userId, now } = params;
  const rows = await prisma.registration.findMany({
    where: { volunteerId: userId },
    orderBy: { createdAt: 'desc' },
    select: REGISTRATION_SELECT,
  });
  return {
    registrations: rows.map((r) => toView(r, now)),
    completed: rows
      .filter((r) => r.status === 'CONFIRMED' && r.attended && r.batch.status === 'COMPLETED')
      .map((r) => ({
        registrationId: r.id,
        title: r.batch.trip.title,
        destination: r.batch.trip.destination,
        startDate: r.batch.startDate,
        endDate: r.batch.endDate,
      })),
  };
}

/**
 * The Volunteer's own Registration on this Batch that still occupies a seat
 * (CONFIRMED, or a HOLD whose window has not passed), or null. holdRegistration
 * refuses a second one with AlreadyRegisteredError; the summary page uses this
 * to point at the existing one instead of offering a button that ends there.
 */
export async function findOwnLiveRegistration(
  prisma: PrismaClient,
  params: { batchId: string; userId: string; now: Date },
): Promise<{ id: string; status: 'HOLD' | 'CONFIRMED' } | null> {
  const { batchId, userId, now } = params;
  const found = await prisma.registration.findFirst({
    where: {
      batchId,
      volunteerId: userId,
      OR: [{ status: 'CONFIRMED' }, { status: 'HOLD', holdExpiresAt: { gt: now } }],
    },
    select: { id: true, status: true },
  });
  return found && (found.status === 'HOLD' || found.status === 'CONFIRMED') ? { id: found.id, status: found.status } : null;
}
