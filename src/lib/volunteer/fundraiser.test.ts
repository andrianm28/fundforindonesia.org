import { describe, it, expect, vi } from 'vitest';
import { getFundraiserTripDetail, listFundraiserTrips } from './fundraiser';

const NOW = new Date('2026-12-10T00:00:00Z');

function tripRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    slug: 'sumba',
    title: 'Mengajar di Sumba',
    description: 'd',
    story: 's',
    coverImage: 'https://example.com/c.jpg',
    destination: 'Sumba',
    itinerary: 'i',
    tripFeeAmount: 1_000_000,
    status: 'REJECTED',
    fundraiserId: 'owner-1',
    batches: [
      {
        id: 'b1',
        startDate: new Date('2026-12-01T00:00:00Z'),
        endDate: new Date('2026-12-05T00:00:00Z'),
        registrationDeadline: new Date('2026-11-20T00:00:00Z'),
        maxQuota: 10,
        minQuota: 2,
        status: 'OPEN',
        registrations: [{ id: 'r1', attended: false, volunteer: { name: 'Budi' } }],
      },
    ],
    statusChanges: [{ reason: 'Itinerary kurang jelas' }],
    ...overrides,
  };
}

const prismaWith = (record: unknown) =>
  ({ volunteerTrip: { findUnique: vi.fn().mockResolvedValue(record), findMany: vi.fn() } }) as never;

describe('getFundraiserTripDetail', () => {
  it('returns the owner their Trip with the newest rejection reason while Rejected', async () => {
    const detail = await getFundraiserTripDetail(prismaWith(tripRecord()), 'owner-1', 'sumba', NOW);
    expect(detail).toMatchObject({ slug: 'sumba', editable: true, rejectionReason: 'Itinerary kurang jelas' });
    expect(detail?.batches[0]).toMatchObject({ ended: true, roster: [{ id: 'r1', name: 'Budi', attended: false }] });
  });

  it('asks only for the newest SUBMISSION_REJECTED change', async () => {
    const prisma = prismaWith(tripRecord());
    await getFundraiserTripDetail(prisma, 'owner-1', 'sumba', NOW);
    const call = (prisma as never as { volunteerTrip: { findUnique: ReturnType<typeof vi.fn> } }).volunteerTrip
      .findUnique.mock.calls[0][0];
    expect(call.include.statusChanges).toMatchObject({
      where: { action: 'SUBMISSION_REJECTED' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
  });

  it('shows no reason once the Trip is no longer Rejected, and calls Active uneditable', async () => {
    const detail = await getFundraiserTripDetail(prismaWith(tripRecord({ status: 'ACTIVE' })), 'owner-1', 'sumba', NOW);
    expect(detail).toMatchObject({ editable: false, rejectionReason: null });
  });

  it('answers null for a Trip owned by someone else, and for none', async () => {
    expect(await getFundraiserTripDetail(prismaWith(tripRecord()), 'stranger', 'sumba', NOW)).toBeNull();
    expect(await getFundraiserTripDetail(prismaWith(null), 'owner-1', 'nope', NOW)).toBeNull();
  });

  it('marks a Batch not ended before its endDate', async () => {
    const early = new Date('2026-12-02T00:00:00Z');
    const detail = await getFundraiserTripDetail(prismaWith(tripRecord()), 'owner-1', 'sumba', early);
    expect(detail?.batches[0].ended).toBe(false);
  });
});

describe('listFundraiserTrips', () => {
  it('lists only the caller\'s Trips, in every status, with their Batch count', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { slug: 'a', title: 'A', destination: 'X', status: 'DRAFT', _count: { batches: 2 } },
    ]);
    const list = await listFundraiserTrips({ volunteerTrip: { findMany } } as never, 'owner-1');
    expect(findMany.mock.calls[0][0].where).toEqual({ fundraiserId: 'owner-1' });
    expect(list).toEqual([{ slug: 'a', title: 'A', destination: 'X', status: 'DRAFT', batchCount: 2 }]);
  });
});
