import type { Prisma } from '@/generated/prisma/client';

/**
 * Prayer (doa) moderation (PKS Pasal 3.7c). A Verifier or an Admin may hide a
 * Prayer, show it again, or delete it (a soft delete: the row stays, with who
 * and when). A hidden or deleted Prayer is out of every public list.
 *
 * `publicPrayerWhere()` is THE public rule: every reader that shows Prayers to
 * visitors (the Campaign page and Prayer Wall feeds, the home page, Aamiin)
 * spreads it into its query; nobody writes `hidden: false` themselves.
 */
export const PRAYER_MODERATION_ACTIONS = ['hide', 'show', 'delete'] as const;
export type PrayerModerationAction = (typeof PRAYER_MODERATION_ACTIONS)[number];

export function publicPrayerWhere(): Prisma.PrayerWhereInput {
  return { hidden: false, deletedAt: null };
}

/** The same rule for a Prayer already in hand. */
export function isPublicPrayer(prayer: { hidden: boolean; deletedAt: Date | null }): boolean {
  return !prayer.hidden && !prayer.deletedAt;
}

/** OK; NOT_FOUND (no such Prayer); GONE (already deleted, so nothing may change it). */
export type PrayerModerationOutcome = 'OK' | 'NOT_FOUND' | 'GONE';

/**
 * Each change is one guarded `updateMany`, so two moderators racing cannot
 * overwrite each other's record: hiding only touches a Prayer that is not yet
 * hidden (the first moderator and time stay), showing only one that is, and
 * nothing touches a deleted one. When the guard matches nothing the Prayer is
 * read once to say why.
 */
export async function moderatePrayer(
  db: Pick<Prisma.TransactionClient, 'prayer'>,
  input: { prayerId: string; action: PrayerModerationAction; actorId: string; now: Date },
): Promise<PrayerModerationOutcome> {
  const { prayerId, action, actorId, now } = input;

  const changed =
    action === 'hide'
      ? await db.prayer.updateMany({
          where: { id: prayerId, deletedAt: null, hidden: false },
          data: { hidden: true, hiddenAt: now, hiddenById: actorId },
        })
      : action === 'show'
        ? await db.prayer.updateMany({
            where: { id: prayerId, deletedAt: null, hidden: true },
            data: { hidden: false, hiddenAt: null, hiddenById: null },
          })
        : await db.prayer.updateMany({
            where: { id: prayerId, deletedAt: null },
            data: { deletedAt: now, deletedById: actorId },
          });
  if (changed.count > 0) return 'OK';

  const existing = await db.prayer.findUnique({ where: { id: prayerId }, select: { id: true, deletedAt: true } });
  if (!existing) return 'NOT_FOUND';
  // Deleted: final. Otherwise the Prayer is already in the state asked for.
  return existing.deletedAt ? 'GONE' : 'OK';
}

export type PrayerModerationFilter = 'visible' | 'hidden';

export interface PrayerForModeration {
  id: string;
  text: string;
  amiinCount: number;
  createdAt: Date;
  campaignSlug: string;
  campaignTitle: string;
  hidden: boolean;
  hiddenAt: Date | null;
  /** Who hid it, by name; null when it is not hidden or the account is gone. */
  hiddenByName: string | null;
}

/**
 * The moderators' list: Prayers that are not deleted, newest first, either the
 * visible ones or the hidden ones. The Donor is deliberately not part of it:
 * a moderator judges the text, and an anonymous Donor stays anonymous to them
 * as to everyone (ADR 0023). A deleted Prayer is kept as a record but no list
 * offers it again.
 */
export async function listPrayersForModeration(
  db: Pick<Prisma.TransactionClient, 'prayer' | 'user'>,
  input: { filter: PrayerModerationFilter; page: number; limit: number },
): Promise<{ prayers: PrayerForModeration[]; total: number }> {
  const where: Prisma.PrayerWhereInput = { deletedAt: null, hidden: input.filter === 'hidden' };
  const [rows, total] = await Promise.all([
    db.prayer.findMany({
      where,
      select: {
        id: true,
        text: true,
        amiinCount: true,
        createdAt: true,
        hidden: true,
        hiddenAt: true,
        hiddenById: true,
        campaign: { select: { slug: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    db.prayer.count({ where }),
  ]);

  const moderatorIds = [...new Set(rows.flatMap((r) => (r.hiddenById ? [r.hiddenById] : [])))];
  const moderators = moderatorIds.length
    ? await db.user.findMany({ where: { id: { in: moderatorIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(moderators.map((m) => [m.id, m.name]));

  return {
    total,
    prayers: rows.map((r) => ({
      id: r.id,
      text: r.text,
      amiinCount: r.amiinCount,
      createdAt: r.createdAt,
      campaignSlug: r.campaign.slug,
      campaignTitle: r.campaign.title,
      hidden: r.hidden,
      hiddenAt: r.hiddenAt,
      hiddenByName: r.hiddenById ? (nameOf.get(r.hiddenById) ?? null) : null,
    })),
  };
}
