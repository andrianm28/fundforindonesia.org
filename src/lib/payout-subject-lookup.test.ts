import { describe, it, expect, vi } from 'vitest';
import { loadPayoutSubject, loadPayoutSubjects, payoutSubjectKey } from './payout-subject-lookup';

/**
 * A Payout names a Campaign or a Volunteer Trip, never both
 * (assertExactlyOnePayoutSubject, src/lib/money/payout-subject.ts), and
 * volunteerTripId carries no Prisma relation. Both the Admin queue and the
 * Admin detail page need the same title+slug lookup; this is the one place
 * it is written.
 */
function fakePrisma(overrides: Record<string, any> = {}) {
  return {
    campaign: { findUnique: vi.fn(), findMany: vi.fn() },
    volunteerTrip: { findUnique: vi.fn(), findMany: vi.fn() },
    ...overrides,
  } as any;
}

describe('payoutSubjectKey', () => {
  it('keys a Campaign Payout by its campaignId', () => {
    expect(payoutSubjectKey({ campaignId: 'campaign-1', volunteerTripId: null })).toBe('campaign:campaign-1');
  });

  it('keys a Trip Payout by its volunteerTripId', () => {
    expect(payoutSubjectKey({ campaignId: null, volunteerTripId: 'trip-1' })).toBe('trip:trip-1');
  });
});

describe('loadPayoutSubject', () => {
  it('resolves a Campaign Payout through the Campaign lookup', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findUnique.mockResolvedValue({ slug: 'sumur-desa', title: 'Sumur untuk Desa' });

    const subject = await loadPayoutSubject(prisma, { campaignId: 'campaign-1', volunteerTripId: null });

    expect(subject).toEqual({ type: 'campaign', slug: 'sumur-desa', title: 'Sumur untuk Desa' });
    expect(prisma.volunteerTrip.findUnique).not.toHaveBeenCalled();
  });

  it('resolves a Trip Payout through the Volunteer Trip lookup', async () => {
    const prisma = fakePrisma();
    prisma.volunteerTrip.findUnique.mockResolvedValue({ slug: 'trip-lombok', title: 'Trip ke Lombok' });

    const subject = await loadPayoutSubject(prisma, { campaignId: null, volunteerTripId: 'trip-1' });

    expect(subject).toEqual({ type: 'trip', slug: 'trip-lombok', title: 'Trip ke Lombok' });
    expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the named subject row no longer exists', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findUnique.mockResolvedValue(null);

    expect(await loadPayoutSubject(prisma, { campaignId: 'gone', volunteerTripId: null })).toBeNull();
  });
});

describe('loadPayoutSubjects', () => {
  it('batches Campaign and Trip lookups and keys the result by payoutSubjectKey', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findMany.mockResolvedValue([{ id: 'campaign-1', slug: 'sumur-desa', title: 'Sumur untuk Desa' }]);
    prisma.volunteerTrip.findMany.mockResolvedValue([{ id: 'trip-1', slug: 'trip-lombok', title: 'Trip ke Lombok' }]);

    const subjects = await loadPayoutSubjects(prisma, [
      { campaignId: 'campaign-1', volunteerTripId: null },
      { campaignId: null, volunteerTripId: 'trip-1' },
    ]);

    expect(subjects.get('campaign:campaign-1')).toEqual({ type: 'campaign', slug: 'sumur-desa', title: 'Sumur untuk Desa' });
    expect(subjects.get('trip:trip-1')).toEqual({ type: 'trip', slug: 'trip-lombok', title: 'Trip ke Lombok' });
  });

  it('skips both lookups for an empty list', async () => {
    const prisma = fakePrisma();

    const subjects = await loadPayoutSubjects(prisma, []);

    expect(subjects.size).toBe(0);
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
    expect(prisma.volunteerTrip.findMany).not.toHaveBeenCalled();
  });
});
