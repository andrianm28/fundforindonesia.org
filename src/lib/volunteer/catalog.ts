import type { PrismaClient } from '@/generated/prisma/client';

/**
 * The public Volunteer Trip reads behind /volunteer-trip and
 * /volunteer-trip/[slug] (ticket 33). Only an ACTIVE Trip is ever public:
 * every other status (DRAFT, SUBMITTED, REJECTED, SUSPENDED, CANCELLED) is
 * invisible here, as it is on GET /api/volunteer-trips.
 *
 * Seats are counted the way holdRegistration counts them (trip.ts): HOLD and
 * CONFIRMED Registrations occupy a seat against maxQuota, except a HOLD whose
 * window has passed, which expireLapsedHolds would free on the next hold.
 * A page render must not write, so the lapsed HOLD is simply not counted.
 */

export type CatalogTripCard = {
  slug: string;
  title: string;
  destination: string;
  coverImage: string;
  tripFeeAmount: number;
  nearestBatchStart: Date;
};

/** OPEN: takes Registrations; FULL: no seat left; CLOSED: deadline passed. */
export type BatchAvailability = 'OPEN' | 'FULL' | 'CLOSED';

export type TripDetailBatch = {
  id: string;
  startDate: Date;
  endDate: Date;
  registrationDeadline: Date;
  maxQuota: number;
  seatsLeft: number;
  availability: BatchAvailability;
};

export type TripDetail = {
  slug: string;
  title: string;
  description: string;
  story: string;
  coverImage: string;
  destination: string;
  itinerary: string;
  tripFeeAmount: number;
  batches: TripDetailBatch[];
};

const byStartDate = <T extends { startDate: Date }>(a: T, b: T) => a.startDate.getTime() - b.startDate.getTime();

/** ACTIVE Trips with at least one OPEN Batch still before its deadline, soonest Batch first. */
export async function listCatalogTrips(prisma: PrismaClient, now: Date): Promise<CatalogTripCard[]> {
  const trips = await prisma.volunteerTrip.findMany({
    where: { status: 'ACTIVE' },
    select: {
      slug: true,
      title: true,
      destination: true,
      coverImage: true,
      tripFeeAmount: true,
      batches: {
        where: { status: 'OPEN' },
        orderBy: { startDate: 'asc' },
        select: { startDate: true, registrationDeadline: true },
      },
    },
  });

  const cards: CatalogTripCard[] = [];
  for (const trip of trips) {
    const takingRegistrations = trip.batches.filter((b) => b.registrationDeadline > now).sort(byStartDate);
    if (takingRegistrations.length === 0) continue;
    cards.push({
      slug: trip.slug,
      title: trip.title,
      destination: trip.destination,
      coverImage: trip.coverImage,
      tripFeeAmount: trip.tripFeeAmount,
      nearestBatchStart: takingRegistrations[0].startDate,
    });
  }
  return cards.sort((a, b) => a.nearestBatchStart.getTime() - b.nearestBatchStart.getTime());
}

/** An ACTIVE Trip with its OPEN Batches and their seats left; null for any other Trip or slug. */
export async function getTripDetail(prisma: PrismaClient, slug: string, now: Date): Promise<TripDetail | null> {
  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    select: {
      slug: true,
      status: true,
      title: true,
      description: true,
      story: true,
      coverImage: true,
      destination: true,
      itinerary: true,
      tripFeeAmount: true,
      batches: {
        where: { status: 'OPEN' },
        orderBy: { startDate: 'asc' },
        select: { id: true, startDate: true, endDate: true, registrationDeadline: true, maxQuota: true },
      },
    },
  });
  if (!trip || trip.status !== 'ACTIVE') return null;

  const batchIds = trip.batches.map((b) => b.id);
  const live =
    batchIds.length === 0
      ? []
      : await prisma.registration.findMany({
          where: { batchId: { in: batchIds }, status: { in: ['HOLD', 'CONFIRMED'] } },
          select: { batchId: true, status: true, holdExpiresAt: true },
        });

  const occupied = new Map<string, number>();
  for (const r of live) {
    if (r.status === 'HOLD' && r.holdExpiresAt <= now) continue;
    occupied.set(r.batchId, (occupied.get(r.batchId) ?? 0) + 1);
  }

  const batches = [...trip.batches].sort(byStartDate).map((b): TripDetailBatch => {
    const seatsLeft = Math.max(0, b.maxQuota - (occupied.get(b.id) ?? 0));
    const availability: BatchAvailability =
      b.registrationDeadline <= now ? 'CLOSED' : seatsLeft === 0 ? 'FULL' : 'OPEN';
    return {
      id: b.id,
      startDate: b.startDate,
      endDate: b.endDate,
      registrationDeadline: b.registrationDeadline,
      maxQuota: b.maxQuota,
      seatsLeft,
      availability,
    };
  });

  return {
    slug: trip.slug,
    title: trip.title,
    description: trip.description,
    story: trip.story,
    coverImage: trip.coverImage,
    destination: trip.destination,
    itinerary: trip.itinerary,
    tripFeeAmount: trip.tripFeeAmount,
    batches,
  };
}
