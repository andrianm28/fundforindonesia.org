import type { PrismaClient } from '@/generated/prisma/client';

/**
 * A Refund's Payment names a Campaign (through its Donation) or a
 * Volunteer Trip (through its Registration's Batch), never both
 * (assertExactlyOnePaymentSubject, src/lib/money/payment-subject.ts) --
 * the same derivation paymentSubjectOf makes in src/lib/money/refunds.ts,
 * read here off the same two relations rather than duplicated as a second
 * subject id on Refund itself. The Admin queue
 * (src/app/admin/refunds/page.tsx) and the Admin detail page
 * (src/app/admin/refunds/[id]/page.tsx) both need a Refund's subject title
 * and slug, one to batch-resolve many rows and the other to resolve one --
 * this is the single place either lookup is written, mirroring
 * payout-subject-lookup.ts's shape for the Payout sibling.
 */
export interface RefundSubjectInfo {
  type: 'campaign' | 'trip';
  slug: string;
  title: string;
}

type SubjectRow = {
  payment: {
    donation: { campaignId: string } | null;
    registration: { batch: { tripId: string } } | null;
  };
};

function subjectIdOf(row: SubjectRow): { type: 'campaign' | 'trip'; id: string } {
  return row.payment.donation
    ? { type: 'campaign', id: row.payment.donation.campaignId }
    : { type: 'trip', id: row.payment.registration!.batch.tripId };
}

/** The Map key both lookups below key their result by. */
export function refundSubjectKey(row: SubjectRow): string {
  const { type, id } = subjectIdOf(row);
  return `${type}:${id}`;
}

/** One Refund's subject, or null when the row it names no longer exists. */
export async function loadRefundSubject(prisma: PrismaClient, row: SubjectRow): Promise<RefundSubjectInfo | null> {
  const { type, id } = subjectIdOf(row);
  if (type === 'campaign') {
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { slug: true, title: true } });
    return campaign ? { type: 'campaign', slug: campaign.slug, title: campaign.title } : null;
  }
  const trip = await prisma.volunteerTrip.findUnique({ where: { id }, select: { slug: true, title: true } });
  return trip ? { type: 'trip', slug: trip.slug, title: trip.title } : null;
}

/**
 * Many Refunds' subjects, batched into at most one Campaign query and one
 * Volunteer Trip query rather than one query per row, keyed by
 * `refundSubjectKey` so a caller can look each Refund's own subject back up.
 */
export async function loadRefundSubjects(
  prisma: PrismaClient,
  rows: SubjectRow[],
): Promise<Map<string, RefundSubjectInfo>> {
  const ids = rows.map(subjectIdOf);
  const campaignIds = [...new Set(ids.filter((s) => s.type === 'campaign').map((s) => s.id))];
  const tripIds = [...new Set(ids.filter((s) => s.type === 'trip').map((s) => s.id))];

  const [campaigns, trips] = await Promise.all([
    campaignIds.length > 0
      ? prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, slug: true, title: true } })
      : Promise.resolve([]),
    tripIds.length > 0
      ? prisma.volunteerTrip.findMany({ where: { id: { in: tripIds } }, select: { id: true, slug: true, title: true } })
      : Promise.resolve([]),
  ]);

  const subjects = new Map<string, RefundSubjectInfo>();
  for (const campaign of campaigns) {
    subjects.set(`campaign:${campaign.id}`, { type: 'campaign', slug: campaign.slug, title: campaign.title });
  }
  for (const trip of trips) {
    subjects.set(`trip:${trip.id}`, { type: 'trip', slug: trip.slug, title: trip.title });
  }
  return subjects;
}
