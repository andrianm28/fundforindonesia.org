import type { PrismaClient, Payout } from '@/generated/prisma/client';

/**
 * A Payout names exactly one of a Campaign or a Volunteer Trip
 * (assertExactlyOnePayoutSubject, src/lib/money/payout-subject.ts), and
 * `Payout.volunteerTripId` carries no Prisma relation -- "neither this nor
 * any other ticket has needed .include() through it yet" (schema comment).
 * The Admin queue (src/app/admin/payouts/page.tsx) and the Admin detail page
 * (src/app/admin/payouts/[id]/page.tsx) both need a Payout's subject title
 * and slug, one to batch-resolve many rows and the other to resolve one;
 * this is the single place either lookup is written.
 */
export interface PayoutSubjectInfo {
  type: 'campaign' | 'trip';
  slug: string;
  title: string;
}

type SubjectRow = Pick<Payout, 'campaignId' | 'volunteerTripId'>;

/** The Map key both lookups below key their result by. */
export function payoutSubjectKey(payout: SubjectRow): string {
  return payout.campaignId ? `campaign:${payout.campaignId}` : `trip:${payout.volunteerTripId}`;
}

/** One Payout's subject, or null when the row it names no longer exists. */
export async function loadPayoutSubject(prisma: PrismaClient, payout: SubjectRow): Promise<PayoutSubjectInfo | null> {
  if (payout.campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: payout.campaignId },
      select: { slug: true, title: true },
    });
    return campaign ? { type: 'campaign', slug: campaign.slug, title: campaign.title } : null;
  }
  const trip = await prisma.volunteerTrip.findUnique({
    where: { id: payout.volunteerTripId! },
    select: { slug: true, title: true },
  });
  return trip ? { type: 'trip', slug: trip.slug, title: trip.title } : null;
}

/**
 * Many Payouts' subjects, batched into at most one Campaign query and one
 * Volunteer Trip query rather than one query per row, keyed by
 * `payoutSubjectKey` so a caller can look each Payout's own subject back up.
 */
export async function loadPayoutSubjects(
  prisma: PrismaClient,
  payouts: SubjectRow[],
): Promise<Map<string, PayoutSubjectInfo>> {
  const campaignIds = [...new Set(payouts.map((p) => p.campaignId).filter((id): id is string => id != null))];
  const tripIds = [...new Set(payouts.map((p) => p.volunteerTripId).filter((id): id is string => id != null))];

  const [campaigns, trips] = await Promise.all([
    campaignIds.length > 0
      ? prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, slug: true, title: true } })
      : Promise.resolve([]),
    tripIds.length > 0
      ? prisma.volunteerTrip.findMany({ where: { id: { in: tripIds } }, select: { id: true, slug: true, title: true } })
      : Promise.resolve([]),
  ]);

  const subjects = new Map<string, PayoutSubjectInfo>();
  for (const campaign of campaigns) {
    subjects.set(`campaign:${campaign.id}`, { type: 'campaign', slug: campaign.slug, title: campaign.title });
  }
  for (const trip of trips) {
    subjects.set(`trip:${trip.id}`, { type: 'trip', slug: trip.slug, title: trip.title });
  }
  return subjects;
}
