import type { PrismaClient, VolunteerBatchStatus, VolunteerTripStatus } from '@/generated/prisma/client';
import { liveRegistrationWhere, TRIP_EDITABLE_STATUSES } from './trip';

/**
 * The Fundraiser's own reads behind /akun/volunteer-trip (ticket 35): their
 * Trips in every status, and one Trip with its Batches and the roster a
 * Batch completion marks attendance on. Server only. A Trip that is not the
 * caller's is indistinguishable from one that does not exist (null), so the
 * page answers 404 for both.
 */

export type FundraiserTripSummary = {
  slug: string;
  title: string;
  destination: string;
  status: VolunteerTripStatus;
  batchCount: number;
};

export type FundraiserRosterEntry = { id: string; name: string; attended: boolean };

export type FundraiserBatch = {
  id: string;
  startDate: Date;
  endDate: Date;
  registrationDeadline: Date;
  maxQuota: number;
  minQuota: number;
  status: VolunteerBatchStatus;
  /** The CONFIRMED Registrations: who a completion marks present. */
  roster: FundraiserRosterEntry[];
  /**
   * Seats held or confirmed (a HOLD counts until its window lapses). Above
   * zero, editBatch refuses to move the dates or cut the quota below it
   * (ticket 48), so the screen shows those fields read-only.
   */
  seatsUsed: number;
  /** True once the endDate has passed: completeBatch refuses sooner. */
  ended: boolean;
};

export type FundraiserTripDetail = {
  id: string;
  slug: string;
  title: string;
  description: string;
  story: string;
  coverImage: string;
  destination: string;
  itinerary: string;
  tripFeeAmount: number;
  status: VolunteerTripStatus;
  /** Draft and Rejected only; the same set submitTrip and the edit route use. */
  editable: boolean;
  /** The Verifier's reason on the newest rejection, shown only while the Trip is Rejected. */
  rejectionReason: string | null;
  batches: FundraiserBatch[];
};

export async function listFundraiserTrips(prisma: PrismaClient, userId: string): Promise<FundraiserTripSummary[]> {
  const trips = await prisma.volunteerTrip.findMany({
    where: { fundraiserId: userId },
    orderBy: { createdAt: 'desc' },
    select: { slug: true, title: true, destination: true, status: true, _count: { select: { batches: true } } },
  });
  return trips.map((t) => ({
    slug: t.slug,
    title: t.title,
    destination: t.destination,
    status: t.status,
    batchCount: t._count.batches,
  }));
}

export async function getFundraiserTripDetail(
  prisma: PrismaClient,
  userId: string,
  slug: string,
  now: Date,
): Promise<FundraiserTripDetail | null> {
  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    include: {
      batches: {
        orderBy: { startDate: 'asc' },
        include: {
          registrations: {
            where: liveRegistrationWhere(now),
            orderBy: { createdAt: 'asc' },
            select: { id: true, status: true, attended: true, volunteer: { select: { name: true } } },
          },
        },
      },
      statusChanges: {
        where: { action: 'SUBMISSION_REJECTED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { reason: true },
      },
    },
  });
  if (!trip || trip.fundraiserId !== userId) return null;

  return {
    id: trip.id,
    slug: trip.slug,
    title: trip.title,
    description: trip.description,
    story: trip.story,
    coverImage: trip.coverImage,
    destination: trip.destination,
    itinerary: trip.itinerary,
    tripFeeAmount: trip.tripFeeAmount,
    status: trip.status,
    editable: TRIP_EDITABLE_STATUSES.includes(trip.status),
    rejectionReason: trip.status === 'REJECTED' ? (trip.statusChanges[0]?.reason ?? null) : null,
    batches: trip.batches.map((b) => ({
      id: b.id,
      startDate: b.startDate,
      endDate: b.endDate,
      registrationDeadline: b.registrationDeadline,
      maxQuota: b.maxQuota,
      minQuota: b.minQuota,
      status: b.status,
      ended: b.endDate <= now,
      seatsUsed: b.registrations.length,
      roster: b.registrations
        .filter((r) => r.status === 'CONFIRMED')
        .map((r) => ({ id: r.id, name: r.volunteer.name ?? 'Tanpa nama', attended: r.attended })),
    })),
  };
}
