import { prisma } from '@/lib/prisma';
import { listableCampaignWhere } from '@/lib/subject-guard';
import { HeroBanner } from '@/components/home/HeroBanner';
import QuickActionTiles from '@/components/home/QuickActionTiles';
import { UrgentCampaigns } from '@/components/home/UrgentCampaigns';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import { PrayerWall } from '@/components/home/PrayerWall';
import type { CampaignCardData } from '@/types/campaign';
import type { PrayerStreamItem } from '@/lib/hooks/usePrayerStream';
import { quickActionTiles } from '@/lib/home/quickActionTiles';

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

// Hero banner slides
const heroBannerSlides = [
  {
    image: '/images/hero/banner-1.jpg',
    headline: 'Bantu mereka yang membutuhkan, salurkan donasimu sekarang',
    cta: { label: 'Donasi Sekarang', href: '/explore/all' },
  },
  {
    image: '/images/hero/banner-2.jpg',
    headline: 'Zakat lebih mudah dan terpercaya di Fund for Indonesia',
    cta: { label: 'Bayar Zakat', href: '/zakat' },
  },
  {
    image: '/images/hero/banner-3.jpg',
    headline: 'Galang dana untuk kebaikan bersama Fund for Indonesia',
    cta: { label: 'Galang Dana', href: '/campaign/create' },
  },
];

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
  // Fetch data from Prisma directly (server component). Every Campaign list
  // here shows only effectively Active Campaigns (CONTEXT.md, Campaign
  // Status), so the Urgent rail drops a Campaign once its deadline passes.
  const listable = listableCampaignWhere(new Date());
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
      take: 12,
    }),
    prisma.prayer.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        campaign: { select: { id: true, slug: true, title: true } },
        donation: { select: { isAnonymous: true } },
      },
    }),
  ]);

  // Transform data to component-friendly shapes
  const urgentCards = urgentCampaigns.map(toCampaignCardData);
  const newCards = newCampaigns.map(toCampaignCardData);
  const featuredCards = featuredCampaigns.map(toCampaignCardData);
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

      {/* New Campaigns - "Yang Baru di Kitabisa" */}
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

      {/* Featured Campaigns - "Pilihan Kitabisa" */}
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
