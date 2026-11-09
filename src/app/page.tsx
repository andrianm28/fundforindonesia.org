import { prisma } from '@/lib/prisma';
import { withCountedCollectedAmount } from '@/lib/money/counted-payment';
import { catalogueDemoWhere, listableCampaignWhere, showDemoCampaigns } from '@/lib/subject-guard';
import { HeroBanner } from '@/components/home/HeroBanner';
import QuickActionTiles from '@/components/home/QuickActionTiles';
import { UrgentCampaigns } from '@/components/home/UrgentCampaigns';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { PrayerWall } from '@/components/home/PrayerWall';
import type { CampaignCardData } from '@/types/campaign';
import type { PrayerStreamItem } from '@/lib/hooks/usePrayerStream';
import { quickActionTiles } from '@/lib/home/quickActionTiles';
import { resolveSiteSettingsOrDefaults } from '@/lib/site-settings';
import { publicPrayerWhere } from '@/lib/prayer-moderation';
import { CampaignFeatureKind, loadFeaturedCampaigns, loadHighlightedPrayers } from '@/lib/home-curation';
import { CategoryFeatured } from '@/components/home/CategoryFeatured';
import { PrayerHighlights } from '@/components/home/PrayerHighlights';

/**
 * Rendered per request, not prerendered.
 *
 * This page was `export const revalidate = 300`, which makes Next prerender it
 * at build time and refresh it in the background afterwards. Neither half
 * worked here. The Docker build runs with a dummy DATABASE_URL, so the baked
 * HTML contains no campaigns at all -- the sections are conditional on
 * `length > 0` and simply vanish. And the background refresh cannot persist:
 * the runtime image has no writable `.next`, so the container serves that
 * empty snapshot.
 *
 * The result was a donation homepage listing nothing while the database held
 * 23 active campaigns, with no error anywhere to say so.
 *
 * Caching a live campaign list at build time is the wrong shape regardless: a
 * campaign published after the image was built would not appear until someone
 * rebuilt it. Four indexed queries per request is the cheaper mistake.
 */
export const dynamic = 'force-dynamic';

/**
 * Map a Prisma campaign result to CampaignCardData for the CampaignGrid component.
 */
function toCampaignCardData(campaign: {
  id: string;
  slug: string;
  title: string;
  coverImage: string;
  collectedAmount: number;
  targetAmount: number;
  category: string;
  deadline: Date | null;
  isUrgent: boolean;
  isDemo: boolean;
  creator: {
    name: string;
  };
}): CampaignCardData {
  return {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    coverImage: campaign.coverImage,
    collectedAmount: campaign.collectedAmount,
    targetAmount: campaign.targetAmount,
    category: campaign.category,
    deadline: campaign.deadline,
    isUrgent: campaign.isUrgent,
    isDemo: campaign.isDemo,
    creator: campaign.creator,
  };
}

/**
 * Map a Prisma prayer result to PrayerStreamItem for the PrayerWall component.
 */
function toPrayerStreamItem(prayer: {
  id: string;
  text: string;
  amiinCount: number;
  donationId: string;
  campaignId: string;
  userId: string | null;
  createdAt: Date;
  user: { id: string; name: string; avatar: string | null } | null;
  campaign: { id: string; slug: string; title: string };
  donation: { isAnonymous: boolean };
}): PrayerStreamItem {
  return {
    id: prayer.id,
    text: prayer.text,
    amiinCount: prayer.amiinCount,
    donationId: prayer.donationId,
    campaignId: prayer.campaignId,
    userId: prayer.userId,
    createdAt: prayer.createdAt,
    user: prayer.donation.isAnonymous
      ? null
      : prayer.user
        ? { id: prayer.user.id, name: prayer.user.name, avatar: prayer.user.avatar }
        : null,
    campaign: {
      id: prayer.campaign.id,
      slug: prayer.campaign.slug,
      title: prayer.campaign.title,
    },
  };
}

export default async function HomePage() {
  const { hero } = await resolveSiteSettingsOrDefaults(prisma);
  const heroBannerSlides = hero.slides.map((s) => ({
    image: s.image,
    headline: s.headline,
    cta: { label: s.ctaLabel, href: s.ctaHref },
  }));
  // Fetch data from Prisma directly (server component). Every Campaign list
  // here shows only effectively Active Campaigns (CONTEXT.md, Campaign
  // Status), so the Urgent rail drops a Campaign once its deadline passes.
  const now = new Date();
  // Whether Demo Campaigns are among them is decided once for the whole
  // render, so the lists and the Prayer Wall agree and the decision costs at
  // most one read (subject-guard's showDemoCampaigns).
  const includeDemo = await showDemoCampaigns(prisma, now);
  const listable = await listableCampaignWhere(prisma, now, { includeDemo });
  const prayerCampaign = await catalogueDemoWhere(prisma, now, { includeDemo });
  const [urgentCampaigns, newCampaigns, featuredCampaigns, recentPrayers] = await Promise.all([
    prisma.campaign.findMany({
      where: { ...listable, isUrgent: true },
      include: {
        creator: {
          select: { name: true },
        },
      },
      take: 10,
    }),
    prisma.campaign.findMany({
      where: listable,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: { name: true },
        },
      },
      take: 10,
    }),
    prisma.campaign.findMany({
      where: listable,
      orderBy: { collectedAmount: 'desc' },
      include: {
        creator: {
          select: { name: true },
        },
      },
      // More than the 12 shown: the stored counter still holds beta (sandbox)
      // money, so the order is settled again below on the counted figure and
      // only then cut to 12 (ticket 94).
      take: 48,
    }),
    prisma.prayer.findMany({
      // The Prayer Wall is a platform-wide feed that names its Campaign and
      // links to it, so it may not name one no public list shows: a visitor
      // would meet a Demo Campaign here, and follow the link to its page
      // (CONTEXT.md, Demo Campaign; prd-compliance 26).
      where: { ...publicPrayerWhere(), campaign: prayerCampaign },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        campaign: { select: { id: true, slug: true, title: true } },
        donation: { select: { isAnonymous: true } },
      },
    }),
  ]);

  // The Admin's curation (PKS pemenuhan 15): marked Campaigns and Prayers,
  // already cut down to what the public may see by the same rules as the
  // lists above. An empty result means "nothing marked (that shows)".
  const [markedPilihan, markedUnggulan, highlightedPrayers] = await Promise.all([
    loadFeaturedCampaigns(prisma, CampaignFeatureKind.PILIHAN, listable),
    loadFeaturedCampaigns(prisma, CampaignFeatureKind.UNGGULAN_KATEGORI, listable),
    loadHighlightedPrayers(prisma, prayerCampaign),
  ]);
  const categories = markedUnggulan.length
    ? await prisma.category.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { slug: true, name: true } })
    : [];

  // Progress as the public may see it (counted-payment.ts): sandbox (beta)
  // Payments are taken back out of the stored counter.
  const [publicUrgent, publicNew, publicFeatured, publicPilihan, publicUnggulan] = await Promise.all([
    withCountedCollectedAmount(prisma, urgentCampaigns),
    withCountedCollectedAmount(prisma, newCampaigns),
    withCountedCollectedAmount(prisma, featuredCampaigns),
    withCountedCollectedAmount(prisma, markedPilihan),
    withCountedCollectedAmount(prisma, markedUnggulan),
  ]);

  // Transform data to component-friendly shapes
  const urgentCards = publicUrgent.map(toCampaignCardData);
  const newCards = publicNew.map(toCampaignCardData);
  // "Pilihan Kami": the Admin's marked Campaigns in their order, else the
  // automatic ranking by the amount counted.
  const featuredCards = publicPilihan.length
    ? publicPilihan.map(toCampaignCardData)
    : [...publicFeatured]
        .sort((a, b) => b.collectedAmount - a.collectedAmount)
        .slice(0, 12)
        .map(toCampaignCardData);
  const unggulanGroups = categories
    .map((category) => ({
      slug: category.slug,
      name: category.name,
      campaigns: publicUnggulan.filter((c) => c.category === category.slug).map(toCampaignCardData),
    }))
    .filter((group) => group.campaigns.length > 0);
  const highlightItems = highlightedPrayers.map(toPrayerStreamItem);
  const prayerItems = recentPrayers.map(toPrayerStreamItem);

  return (
    <div className="min-h-screen bg-bg">
      {/* Hero Banner */}
      <HeroBanner slides={heroBannerSlides} />

      {/* Quick Action Tiles */}
      <QuickActionTiles tiles={quickActionTiles} />

      {/* Urgent Campaigns - "Penggalangan Dana Mendesak" */}
      {urgentCards.length > 0 && (
        <UrgentCampaigns campaigns={urgentCards} isLoading={false} />
      )}

      {/* New Campaigns - "Yang Baru" */}
      {newCards.length > 0 && (
        <section className="px-4 py-4">
          <h2 className="text-lg font-bold text-text mb-3">
            Yang Baru
          </h2>
          <CampaignGrid
            campaigns={newCards}
            variant="compact-scroll"
            emptyMessage="Belum ada kampanye baru"
          />
        </section>
      )}

      {/* Featured Campaigns - "Pilihan Terbaik" */}
      {featuredCards.length > 0 && (
        <section className="px-4 py-4">
          <h2 className="text-lg font-bold text-text mb-3">
            Pilihan Kami
          </h2>
          <CampaignGrid
            campaigns={featuredCards}
            variant="standard"
            emptyMessage="Belum ada kampanye unggulan"
          />
        </section>
      )}

      {/* Unggulan kategori: only Categories with a marked, visible Campaign */}
      {unggulanGroups.length > 0 && <CategoryFeatured groups={unggulanGroups} />}

      {/* Sorotan doa: the Prayers an Admin marked */}
      <PrayerHighlights prayers={highlightItems} />

      {/* Prayer Wall - "Doa-doa #OrangBaik" */}
      <section className="px-4 py-4">
        <PrayerWall
          initialPrayers={prayerItems}
          variant="homepage"
          showCampaignLink
        />
      </section>
    </div>
  );
}
