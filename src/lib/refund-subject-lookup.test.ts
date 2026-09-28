import { describe, it, expect, vi } from 'vitest';
import { loadRefundSubject, loadRefundSubjects, refundSubjectKey } from './refund-subject-lookup';

/**
 * A Refund's Payment names a Campaign (through Donation) or a Volunteer
 * Trip (through Registration/Batch), never both
 * (assertExactlyOnePaymentSubject, src/lib/money/payment-subject.ts), and
 * neither relation is denormalised onto Refund itself. The Admin queue and
 * detail page both need the same title+slug lookup; this is the one place
 * it is written, mirroring payout-subject-lookup.ts's shape for the
 * Payout sibling.
 */
function fakePrisma() {
  return {
    campaign: { findUnique: vi.fn(), findMany: vi.fn() },
    volunteerTrip: { findUnique: vi.fn(), findMany: vi.fn() },
  };
}

const campaignRow = {
  payment: { donation: { campaignId: 'campaign-1' }, registration: null },
};

const tripRow = {
  payment: { donation: null, registration: { batch: { tripId: 'trip-1' } } },
};

describe('refundSubjectKey', () => {
  it('keys a Campaign Refund by its Payment donation campaignId', () => {
    expect(refundSubjectKey(campaignRow)).toBe('campaign:campaign-1');
  });

  it('keys a Trip Refund by its Payment registration batch tripId', () => {
    expect(refundSubjectKey(tripRow)).toBe('trip:trip-1');
  });
});

describe('loadRefundSubject', () => {
  it('resolves a Campaign Refund through the Campaign lookup', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findUnique.mockResolvedValue({ slug: 'sumur-desa', title: 'Sumur untuk Desa' });

    const subject = await loadRefundSubject(prisma as never, campaignRow);

    expect(subject).toEqual({ type: 'campaign', slug: 'sumur-desa', title: 'Sumur untuk Desa' });
    expect(prisma.volunteerTrip.findUnique).not.toHaveBeenCalled();
  });

  it('resolves a Trip Refund through the Volunteer Trip lookup', async () => {
    const prisma = fakePrisma();
    prisma.volunteerTrip.findUnique.mockResolvedValue({ slug: 'trip-lombok', title: 'Trip ke Lombok' });

    const subject = await loadRefundSubject(prisma as never, tripRow);

    expect(subject).toEqual({ type: 'trip', slug: 'trip-lombok', title: 'Trip ke Lombok' });
    expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the named subject row no longer exists', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findUnique.mockResolvedValue(null);

    expect(await loadRefundSubject(prisma as never, campaignRow)).toBeNull();
  });
});

describe('loadRefundSubjects', () => {
  it('batches Campaign and Trip lookups and keys the result by refundSubjectKey', async () => {
    const prisma = fakePrisma();
    prisma.campaign.findMany.mockResolvedValue([{ id: 'campaign-1', slug: 'sumur-desa', title: 'Sumur untuk Desa' }]);
    prisma.volunteerTrip.findMany.mockResolvedValue([{ id: 'trip-1', slug: 'trip-lombok', title: 'Trip ke Lombok' }]);

    const subjects = await loadRefundSubjects(prisma as never, [campaignRow, tripRow]);

    expect(subjects.get('campaign:campaign-1')).toEqual({ type: 'campaign', slug: 'sumur-desa', title: 'Sumur untuk Desa' });
    expect(subjects.get('trip:trip-1')).toEqual({ type: 'trip', slug: 'trip-lombok', title: 'Trip ke Lombok' });
  });

  it('skips both lookups for an empty list', async () => {
    const prisma = fakePrisma();

    const subjects = await loadRefundSubjects(prisma as never, []);

    expect(subjects.size).toBe(0);
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
    expect(prisma.volunteerTrip.findMany).not.toHaveBeenCalled();
  });
});
