import type { Prisma } from '@/generated/prisma/client';
import { CampaignFeatureKind } from '@/generated/prisma/client';
import { publicPrayerWhere } from '@/lib/prayer-moderation';

/**
 * Admin curation of the home page (PKS pemenuhan 15, Pasal 3.7(5)-(6)).
 *
 * Three slots, each an ordered list the Admin sets as a whole:
 *   PILIHAN            "Pilihan Kami": Campaigns shown first in that section
 *   UNGGULAN_KATEGORI  "Unggulan kategori": per Category, the Campaigns marked
 *                      that belong to it (a Campaign is featured in its own
 *                      Category; nothing else to choose)
 *   Sorotan doa        Prayers shown in their own section above the Prayer Wall
 *
 * A mark is a wish, not a grant of visibility: the readers below pass the
 * mark through the same public rules as every other list (`listable` for
 * Campaigns, `publicPrayerWhere` for Prayers), so a marked Campaign that is
 * not Active, or a marked Prayer a moderator hid, never appears. Each mark
 * records who and when. When a slot has nothing visible marked the home page
 * keeps its automatic behaviour.
 */
export { CampaignFeatureKind };

export type HomeCurationDb = Pick<
  Prisma.TransactionClient,
  'campaign' | 'prayer' | 'campaignFeature' | 'prayerHighlight'
>;

/** OK; UNKNOWN_ID when an id names nothing (or, for a Prayer, a deleted one). Nothing is written then. */
export type CurationOutcome = 'OK' | 'UNKNOWN_ID';

const unique = (ids: string[]) => [...new Set(ids)];

/**
 * Replaces one Campaign slot with `campaignIds`, in that order. A Campaign
 * that stays marked keeps its original who and when (only its position
 * moves); a newly marked one records `actorId` and `now`. Run inside a
 * transaction.
 */
export async function setCampaignFeatures(
  db: HomeCurationDb,
  input: { kind: CampaignFeatureKind; campaignIds: string[]; actorId: string; now: Date },
): Promise<CurationOutcome> {
  const ids = unique(input.campaignIds);
  const found = await db.campaign.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) return 'UNKNOWN_ID';

  await db.campaignFeature.deleteMany({ where: { kind: input.kind, campaignId: { notIn: ids } } });
  for (const [position, campaignId] of ids.entries()) {
    await db.campaignFeature.upsert({
      where: { campaignId_kind: { campaignId, kind: input.kind } },
      create: { campaignId, kind: input.kind, position, markedById: input.actorId, markedAt: input.now },
      update: { position },
    });
  }
  return 'OK';
}

/** The same for "Sorotan doa". A deleted Prayer cannot be marked; a hidden one can (it just does not show). */
export async function setPrayerHighlights(
  db: HomeCurationDb,
  input: { prayerIds: string[]; actorId: string; now: Date },
): Promise<CurationOutcome> {
  const ids = unique(input.prayerIds);
  const found = await db.prayer.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
  if (found.length !== ids.length) return 'UNKNOWN_ID';

  await db.prayerHighlight.deleteMany({ where: { prayerId: { notIn: ids } } });
  for (const [position, prayerId] of ids.entries()) {
    await db.prayerHighlight.upsert({
      where: { prayerId },
      create: { prayerId, position, markedById: input.actorId, markedAt: input.now },
      update: { position },
    });
  }
  return 'OK';
}

/**
 * The marked Campaigns of one slot that the public may see (`listable` is the
 * home page's own visibility rule), in the Admin's order. Empty when none is
 * marked or none of them is visible, which is the caller's cue to fall back.
 */
export async function loadFeaturedCampaigns(
  db: Pick<Prisma.TransactionClient, 'campaign' | 'campaignFeature'>,
  kind: CampaignFeatureKind,
  listable: Prisma.CampaignWhereInput,
) {
  const marks = await db.campaignFeature.findMany({
    where: { kind },
    orderBy: [{ position: 'asc' }, { markedAt: 'asc' }],
    select: { campaignId: true },
  });
  if (marks.length === 0) return [];
  const rows = await db.campaign.findMany({
    where: { AND: [listable, { id: { in: marks.map((m) => m.campaignId) } }] },
    include: { creator: { select: { name: true } } },
  });
  const order = new Map(marks.map((m, i) => [m.campaignId, i]));
  return [...rows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** The marked Prayers the public may see (the public Prayer rule plus the Campaign filter), in the Admin's order. */
export async function loadHighlightedPrayers(
  db: Pick<Prisma.TransactionClient, 'prayerHighlight'>,
  prayerCampaign: Prisma.CampaignWhereInput,
) {
  const rows = await db.prayerHighlight.findMany({
    where: { prayer: { ...publicPrayerWhere(), campaign: prayerCampaign } },
    orderBy: [{ position: 'asc' }, { markedAt: 'asc' }],
    select: {
      prayer: {
        include: {
          user: { select: { id: true, name: true, avatar: true } },
          campaign: { select: { id: true, slug: true, title: true } },
          donation: { select: { isAnonymous: true } },
        },
      },
    },
  });
  return rows.map((r) => r.prayer);
}

export interface CuratedCampaign {
  id: string;
  slug: string;
  title: string;
  category: string;
  /** Stored lifecycle status; the Admin sees it to know a mark may not show yet. */
  status: string;
  position: number;
  markedByName: string | null;
  markedAt: Date;
}

export interface CuratedPrayer {
  id: string;
  text: string;
  hidden: boolean;
  campaignTitle: string;
  position: number;
  markedByName: string | null;
  markedAt: Date;
}

export interface CurationOverview {
  pilihan: CuratedCampaign[];
  unggulan: CuratedCampaign[];
  sorotan: CuratedPrayer[];
}

/**
 * What the Admin screen shows: every mark of every slot in its order, with the
 * Campaign or Prayer it names and who marked it (by name; null when the
 * account is gone). Unlike the public readers it does not filter by
 * visibility: the Admin sees a mark even while its Campaign is not Active.
 */
export async function listCuration(
  db: Pick<Prisma.TransactionClient, 'campaignFeature' | 'prayerHighlight' | 'user'>,
): Promise<CurationOverview> {
  const [features, highlights] = await Promise.all([
    db.campaignFeature.findMany({
      orderBy: [{ position: 'asc' }, { markedAt: 'asc' }],
      include: { campaign: { select: { id: true, slug: true, title: true, category: true, lifecycleStatus: true } } },
    }),
    db.prayerHighlight.findMany({
      orderBy: [{ position: 'asc' }, { markedAt: 'asc' }],
      include: { prayer: { select: { id: true, text: true, hidden: true, campaign: { select: { title: true } } } } },
    }),
  ]);

  const actorIds = [...new Set([...features, ...highlights].map((m) => m.markedById))];
  const actors = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(actors.map((a) => [a.id, a.name]));

  const campaignRow = (f: (typeof features)[number]): CuratedCampaign => ({
    id: f.campaign.id,
    slug: f.campaign.slug,
    title: f.campaign.title,
    category: f.campaign.category,
    status: f.campaign.lifecycleStatus,
    position: f.position,
    markedByName: nameOf.get(f.markedById) ?? null,
    markedAt: f.markedAt,
  });

  return {
    pilihan: features.filter((f) => f.kind === CampaignFeatureKind.PILIHAN).map(campaignRow),
    unggulan: features.filter((f) => f.kind === CampaignFeatureKind.UNGGULAN_KATEGORI).map(campaignRow),
    sorotan: highlights.map((h) => ({
      id: h.prayer.id,
      text: h.prayer.text,
      hidden: h.prayer.hidden,
      campaignTitle: h.prayer.campaign.title,
      position: h.position,
      markedByName: nameOf.get(h.markedById) ?? null,
      markedAt: h.markedAt,
    })),
  };
}
