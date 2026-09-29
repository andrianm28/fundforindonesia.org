import { describe, it, expect } from 'vitest';
import { getTripDetail, listCatalogTrips } from './catalog';
import {
  batchRow,
  registrationRow,
  tripRow,
  type BatchRow,
  type RegistrationRow,
  type TripRow,
} from '../../../tests/support/in-memory-trip-db';

/**
 * The public Volunteer Trip catalog and detail read (ticket 33). Seats left
 * count HOLD (unexpired) and CONFIRMED Registrations against maxQuota, the
 * same occupancy holdRegistration enforces.
 */

const NOW = new Date('2026-10-01T00:00:00Z');
const FUTURE_DEADLINE = new Date('2026-11-20T00:00:00Z');
const PAST_DEADLINE = new Date('2026-09-20T00:00:00Z');

type BatchInclude = { batches: { where?: { status?: string } } };

/** Just enough Prisma for the two reads: filters on status and id sets, as they ask. */
function fakePrisma(seed: { trips?: TripRow[]; batches?: BatchRow[]; registrations?: RegistrationRow[] }) {
  const trips = seed.trips ?? [];
  const batches = seed.batches ?? [];
  const registrations = seed.registrations ?? [];
  const withBatches = (t: TripRow, where?: { status?: string }) => ({
    ...t,
    batches: batches.filter((b) => b.tripId === t.id && (!where?.status || b.status === where.status)),
  });
  return {
    volunteerTrip: {
      findMany: async ({ where, include }: { where: { status: string }; include: BatchInclude }) =>
        trips.filter((t) => t.status === where.status).map((t) => withBatches(t, include.batches.where)),
      findUnique: async ({ where, include }: { where: { slug: string }; include: BatchInclude }) => {
        const t = trips.find((x) => x.slug === where.slug);
        return t ? withBatches(t, include.batches.where) : null;
      },
    },
    registration: {
      findMany: async ({ where }: { where: { batchId: { in: string[] }; status: { in: string[] } } }) =>
        registrations.filter((r) => where.batchId.in.includes(r.batchId) && where.status.in.includes(r.status)),
    },
  } as never;
}

const active = (o: Partial<TripRow> = {}) => tripRow({ status: 'ACTIVE', ...o });

describe('listCatalogTrips', () => {
  it('lists an ACTIVE Trip with an OPEN Batch before its deadline, with the nearest Batch start', async () => {
    const prisma = fakePrisma({
      trips: [active()],
      batches: [
        batchRow({ id: 'late', startDate: new Date('2027-02-01T00:00:00Z'), registrationDeadline: FUTURE_DEADLINE }),
        batchRow({ id: 'near', startDate: new Date('2026-12-01T00:00:00Z'), registrationDeadline: FUTURE_DEADLINE }),
      ],
    });

    const cards = await listCatalogTrips(prisma, NOW);

    expect(cards).toEqual([
      {
        slug: 'mengajar-di-pulau-terpencil',
        title: 'Mengajar di Pulau Terpencil',
        destination: 'Pulau Sebatik',
        coverImage: 'https://example.com/cover.jpg',
        tripFeeAmount: 2_500_000,
        nearestBatchStart: new Date('2026-12-01T00:00:00Z'),
      },
    ]);
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'SUSPENDED', 'CANCELLED'] as const)('leaves out a %s Trip', async (status) => {
    const prisma = fakePrisma({ trips: [tripRow({ status })], batches: [batchRow({ registrationDeadline: FUTURE_DEADLINE })] });

    expect(await listCatalogTrips(prisma, NOW)).toEqual([]);
  });

  it('leaves out an ACTIVE Trip whose only Batches are past their deadline or not OPEN', async () => {
    const prisma = fakePrisma({
      trips: [active()],
      batches: [
        batchRow({ id: 'past', registrationDeadline: PAST_DEADLINE }),
        batchRow({ id: 'closed', status: 'CANCELLED', registrationDeadline: FUTURE_DEADLINE }),
      ],
    });

    expect(await listCatalogTrips(prisma, NOW)).toEqual([]);
  });

  it('ignores a past-deadline Batch when choosing the nearest start', async () => {
    const prisma = fakePrisma({
      trips: [active()],
      batches: [
        batchRow({ id: 'past', startDate: new Date('2026-10-10T00:00:00Z'), registrationDeadline: PAST_DEADLINE }),
        batchRow({ id: 'ok', startDate: new Date('2027-01-10T00:00:00Z'), registrationDeadline: FUTURE_DEADLINE }),
      ],
    });

    const [card] = await listCatalogTrips(prisma, NOW);

    expect(card.nearestBatchStart).toEqual(new Date('2027-01-10T00:00:00Z'));
  });
});

describe('getTripDetail', () => {
  it('answers null for a Trip that is not ACTIVE, and for an unknown slug', async () => {
    const prisma = fakePrisma({ trips: [tripRow({ status: 'SUBMITTED' })], batches: [batchRow()] });

    expect(await getTripDetail(prisma, 'mengajar-di-pulau-terpencil', NOW)).toBeNull();
    expect(await getTripDetail(prisma, 'tidak-ada', NOW)).toBeNull();
  });

  it("returns the Trip with each OPEN Batch's seats left, deadline and whether it takes Registrations", async () => {
    const prisma = fakePrisma({
      trips: [active()],
      batches: [
        batchRow({ id: 'b1', maxQuota: 3, registrationDeadline: FUTURE_DEADLINE }),
        batchRow({
          id: 'full',
          maxQuota: 1,
          startDate: new Date('2027-01-01T00:00:00Z'),
          registrationDeadline: FUTURE_DEADLINE,
        }),
        batchRow({ id: 'lapsed', startDate: new Date('2027-02-01T00:00:00Z'), registrationDeadline: PAST_DEADLINE }),
        batchRow({ id: 'cancelled', status: 'CANCELLED', registrationDeadline: FUTURE_DEADLINE }),
      ],
      registrations: [
        registrationRow({ id: 'r1', batchId: 'b1', status: 'CONFIRMED' }),
        registrationRow({ id: 'r2', batchId: 'b1', status: 'HOLD', holdExpiresAt: new Date('2026-10-01T00:10:00Z') }),
        // A HOLD past its window frees its seat, as expireLapsedHolds does.
        registrationRow({ id: 'r3', batchId: 'b1', status: 'HOLD', holdExpiresAt: new Date('2026-09-30T00:00:00Z') }),
        registrationRow({ id: 'r4', batchId: 'b1', status: 'CANCELLED' }),
        registrationRow({ id: 'r5', batchId: 'full', status: 'CONFIRMED' }),
      ],
    });

    const detail = await getTripDetail(prisma, 'mengajar-di-pulau-terpencil', NOW);

    expect(detail).toMatchObject({
      slug: 'mengajar-di-pulau-terpencil',
      destination: 'Pulau Sebatik',
      itinerary: 'Hari 1: tiba. Hari 2-6: mengajar. Hari 7: pulang.',
      story: 'Cerita perjalanan.',
      tripFeeAmount: 2_500_000,
    });
    expect(detail!.batches.map((b) => ({ id: b.id, seatsLeft: b.seatsLeft, availability: b.availability }))).toEqual([
      { id: 'b1', seatsLeft: 1, availability: 'OPEN' },
      { id: 'full', seatsLeft: 0, availability: 'FULL' },
      { id: 'lapsed', seatsLeft: 20, availability: 'CLOSED' },
    ]);
    expect(detail!.batches[0]).toMatchObject({ registrationDeadline: FUTURE_DEADLINE, maxQuota: 3 });
  });
});
