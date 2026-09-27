import { describe, it, expect } from 'vitest';
import { DonationNotSettledForReviewError, evaluateSettledDonationScrutiny } from './scrutiny';

/**
 * What the platform does with the abuse thresholds the moment money
 * arrives (prd-compliance 38, PRD §"Anti penyalahgunaan"): one settled
 * Donation can leave three traces -- the Donation's own marker, the
 * Campaign's audit marker, and the extra Verifier review a large Cumulative
 * Gross earns -- and none of them blocks anything.
 *
 * The review really is a Verification Request, raised by the lifecycle
 * module underneath this one, so the stand-in below answers that module's
 * reads too and the tests assert on the row that reaches the Verifier's
 * queue. Mocking it away would leave the two halves untested against each
 * other, which is the join most likely to rot.
 */

const NOW = new Date('2026-09-28T05:00:00Z');

type SeedDonation = {
  id: string;
  amount: number;
  campaignId: string;
  collectedAmount: number;
  isDemo?: boolean;
};

function makeDb(seed: { donation?: SeedDonation | null; thresholds?: { kind: string; value: number }[] } = {}) {
  const donationMarkers: Record<string, unknown>[] = [];
  const auditMarkers: Record<string, unknown>[] = [];
  const verificationRequests: Record<string, unknown>[] = [];
  const rowLocks: string[] = [];
  const donation =
    seed.donation === undefined
      ? ({ id: 'donation-1', amount: 60_000_000, campaignId: 'campaign-1', collectedAmount: 60_000_000 } as SeedDonation)
      : seed.donation;

  const db = {
    donation: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (!donation || donation.id !== where.id) return null;
        return {
          id: donation.id,
          amount: donation.amount,
          campaign: {
            id: donation.campaignId,
            collectedAmount: donation.collectedAmount,
            isDemo: donation.isDemo ?? false,
            creatorId: 'creator-1',
            lifecycleStatus: 'ACTIVE',
            deadline: null,
            kind: 'DONATION',
            collectingEntityId: 'partner-1',
          },
        };
      },
    },
    abuseThreshold: { findMany: async () => seed.thresholds ?? [] },
    donationReviewMarker: {
      upsert: async ({ where, create }: { where: { donationId: string }; create: Record<string, unknown> }) => {
        const existing = donationMarkers.find((m) => m.donationId === where.donationId);
        if (existing) return existing;
        const row = { id: `marker-${donationMarkers.length + 1}`, ...create };
        donationMarkers.push(row);
        return row;
      },
    },
    campaignAuditMarker: {
      upsert: async ({ where, create }: { where: { campaignId: string }; create: Record<string, unknown> }) => {
        const existing = auditMarkers.find((m) => m.campaignId === where.campaignId);
        if (existing) return existing;
        const row = { id: `audit-${auditMarkers.length + 1}`, ...create };
        auditMarkers.push(row);
        return row;
      },
    },
    // The lifecycle module's own reads, so the amount review it raises is a
    // real row rather than a recorded call.
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      rowLocks.push(`Campaign:${String(values[0])}`);
      return [{ id: values[0] }];
    },
    campaign: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        donation && where.id === donation.campaignId
          ? {
              id: donation.campaignId,
              creatorId: 'creator-1',
              lifecycleStatus: 'ACTIVE',
              deadline: null,
              kind: 'DONATION',
              collectingEntityId: 'partner-1',
            }
          : null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (!donation || where.id !== donation.campaignId) throw new Error('No Campaign found');
        return {
          id: donation.campaignId,
          creatorId: 'creator-1',
          lifecycleStatus: 'ACTIVE',
          deadline: null,
          kind: 'DONATION',
          collectingEntityId: 'partner-1',
        };
      },
    },
    verificationChecklistItem: {
      findMany: async () => [
        { id: 'bukan-duplikat', label: 'Sudah dipastikan bukan duplikat Campaign lain', required: true, position: 1, active: true, kind: null },
      ],
    },
    verificationRequest: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `verification-${verificationRequests.length + 1}`, ...data };
        verificationRequests.push(row);
        return row;
      },
    },
  };
  return { db, donationMarkers, auditMarkers, verificationRequests, rowLocks };
}

describe('evaluateSettledDonationScrutiny', () => {
  it('marks one Donation above the single-Donation threshold, without touching anything about the Donation', async () => {
    const { db, donationMarkers } = makeDb();

    const result = await evaluateSettledDonationScrutiny(db as never, { donationId: 'donation-1', now: NOW });

    expect(result.donationMarker).toMatchObject({
      donationId: 'donation-1',
      amount: 60_000_000,
      threshold: 50_000_000,
    });
    expect(donationMarkers).toHaveLength(1);
  });

  it('marks nothing on a Donation under the threshold, and nothing on the Campaign either', async () => {
    const { db, donationMarkers, auditMarkers, verificationRequests } = makeDb({
      donation: { id: 'donation-1', amount: 40_000_000, campaignId: 'campaign-1', collectedAmount: 40_000_000 },
    });

    const result = await evaluateSettledDonationScrutiny(db as never, { donationId: 'donation-1', now: NOW });

    expect(result).toMatchObject({ donationMarker: null, auditMarker: null, amountReview: null });
    expect(donationMarkers).toEqual([]);
    expect(auditMarkers).toEqual([]);
    expect(verificationRequests).toEqual([]);
  });

  it('opens a PENDING Verifikasi Tambahan the moment the Campaign passes the Cumulative Gross threshold, and leaves the Campaign Active', async () => {
    const { db, verificationRequests, rowLocks } = makeDb({
      donation: { id: 'donation-1', amount: 60_000_000, campaignId: 'campaign-1', collectedAmount: 120_000_000 },
    });

    const result = await evaluateSettledDonationScrutiny(db as never, { donationId: 'donation-1', now: NOW });

    expect(verificationRequests).toEqual([
      {
        id: 'verification-1',
        campaignId: 'campaign-1',
        submittedById: null,
        submittedAt: NOW,
        checklist: [
          {
            id: 'bukan-duplikat',
            label: 'Sudah dipastikan bukan duplikat Campaign lain',
            required: true,
            position: 1,
            ticked: false,
          },
        ],
        isFirst: false,
        collectingEntityId: 'partner-1',
        kind: 'AMOUNT_REVIEW',
        raisedByAmount: { cumulativeGross: 120_000_000, threshold: 100_000_000 },
      },
    ]);
    expect(result.amountReview).toMatchObject({ id: 'verification-1' });
    expect(rowLocks).toEqual(['Campaign:campaign-1']);
  });

  it('does not raise a review for a Campaign that was already above the threshold before this Donation', async () => {
    const { db, verificationRequests } = makeDb({
      donation: { id: 'donation-1', amount: 10_000_000, campaignId: 'campaign-1', collectedAmount: 300_000_000 },
    });

    const result = await evaluateSettledDonationScrutiny(db as never, { donationId: 'donation-1', now: NOW });

    // Only the Donation that crosses the threshold is what raises the review;
    // a later one is just another Donation.
    expect(verificationRequests).toEqual([]);
    expect(result.amountReview).toBeNull();
  });

  it('places one audit marker on a Campaign above the audit threshold, and keeps the first one it placed', async () => {
    const first = makeDb({
      donation: { id: 'donation-1', amount: 600_000_000, campaignId: 'campaign-1', collectedAmount: 600_000_000 },
    });

    const result = await evaluateSettledDonationScrutiny(first.db as never, { donationId: 'donation-1', now: NOW });

    expect(result.auditMarker).toMatchObject({
      campaignId: 'campaign-1',
      cumulativeGross: 600_000_000,
      threshold: 500_000_000,
    });

    // A later, larger settlement asks again and the marker stays the one that
    // says when the Campaign was first noticed.
    const later = makeDb({
      donation: { id: 'donation-2', amount: 100_000_000, campaignId: 'campaign-1', collectedAmount: 700_000_000 },
    });
    await later.db.campaignAuditMarker.upsert({
      where: { campaignId: 'campaign-1' },
      create: { campaignId: 'campaign-1', cumulativeGross: 600_000_000, threshold: 500_000_000, placedAt: NOW },
    });
    const again = await evaluateSettledDonationScrutiny(later.db as never, { donationId: 'donation-2', now: NOW });

    expect(again.auditMarker).toMatchObject({ cumulativeGross: 600_000_000, placedAt: NOW });
    expect(later.auditMarkers).toHaveLength(1);
  });

  it('judges a Demo Campaign on nothing at all: its collected figure is fixture data', async () => {
    const { db, donationMarkers, auditMarkers, verificationRequests } = makeDb({
      donation: {
        id: 'donation-1',
        amount: 600_000_000,
        campaignId: 'campaign-9',
        collectedAmount: 900_000_000,
        isDemo: true,
      },
    });

    const result = await evaluateSettledDonationScrutiny(db as never, { donationId: 'donation-1', now: NOW });

    expect(result).toMatchObject({ donationMarker: null, auditMarker: null, amountReview: null });
    expect(donationMarkers).toEqual([]);
    expect(auditMarkers).toEqual([]);
    expect(verificationRequests).toEqual([]);
  });

  it('uses the limits the Admin has set, not the PRD defaults', async () => {
    const { db, donationMarkers, auditMarkers, verificationRequests } = makeDb({
      donation: { id: 'donation-1', amount: 60_000_000, campaignId: 'campaign-1', collectedAmount: 60_000_000 },
      thresholds: [
        { kind: 'CAMPAIGN_REVIEW_GROSS', value: 50_000_000 },
        { kind: 'CAMPAIGN_AUDIT_GROSS', value: 5_000_000_000 },
        { kind: 'DONATION_REVIEW_AMOUNT', value: 100_000_000 },
      ],
    });

    await evaluateSettledDonationScrutiny(db as never, { donationId: 'donation-1', now: NOW });

    // The Campaign is now over the review threshold an Admin set, and the
    // Donation is under the one they set.
    expect(verificationRequests).toEqual([
      expect.objectContaining({
        kind: 'AMOUNT_REVIEW',
        raisedByAmount: { cumulativeGross: 60_000_000, threshold: 50_000_000 },
      }),
    ]);
    expect(donationMarkers).toEqual([]);
    expect(auditMarkers).toEqual([]);
  });

  it('refuses a Donation that is not there rather than inventing one', async () => {
    const { db } = makeDb({ donation: null });

    await expect(
      evaluateSettledDonationScrutiny(db as never, { donationId: 'donation-404', now: NOW })
    ).rejects.toBeInstanceOf(DonationNotSettledForReviewError);
  });
});
