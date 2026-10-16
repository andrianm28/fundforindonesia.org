import { prisma } from '@/lib/prisma';
import { testDonationAmountForCampaign, withCountedCollectedAmount } from '@/lib/money/counted-payment';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { CampaignDetailView } from '@/components/campaign/CampaignDetailView';
import { StructuredData } from '@/components/shared/SEOHead';
import { effectiveStatus } from '@/lib/campaign-lifecycle';
import { isPubliclyViewable } from '@/lib/campaign-visibility';
import { publicUrl } from '@/lib/public-url';
import { resolvePlatformFeeBasisForCampaign } from '@/lib/money/platform-fee-config';
import { ESCROW_HOLD_DAYS } from '@/lib/money/escrow';

// Was ISR (one render per Campaign, revalidated every 60 seconds). Since
// rilis-1-benda/92 the root layout reads the beta marker per request
// (connection()), which makes every route dynamic, so `revalidate` below no
// longer caches anything; it stays as the statement of intent should the
// marker move out of the layout. The rule it imposed still holds: this page
// never reads the session, and an
// unapproved Campaign (Draft, Submitted, Rejected) renders the 404 here for
// everyone: whatever is cached is safe to serve to anyone. Its Fundraiser,
// Verifiers and Admins see it through ./not-found.tsx, which asks the
// session-aware, never shared-cached GET /api/campaigns/[slug].
export const revalidate = 60;

interface CampaignDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CampaignDetailPageProps): Promise<Metadata> {
  const { slug } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: {
      title: true,
      description: true,
      coverImage: true,
      lifecycleStatus: true,
      deadline: true,
    },
  });

  if (!campaign || !isPubliclyViewable(effectiveStatus(campaign, new Date()))) {
    return { title: 'Campaign Tidak Ditemukan' };
  }

  const canonicalUrl = publicUrl(`/campaign/${slug}`);

  return {
    title: `${campaign.title} - Fund for Indonesia`,
    description: campaign.description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: campaign.title,
      description: campaign.description,
      images: [campaign.coverImage],
      type: 'article',
      url: canonicalUrl,
    },
    twitter: {
      card: 'summary_large_image',
      title: campaign.title,
      description: campaign.description,
      images: [campaign.coverImage],
    },
  };
}

export default async function CampaignDetailPage({ params }: CampaignDetailPageProps) {
  const { slug } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          avatar: true,
        },
      },
      _count: {
        select: {
          // Real Donations only (ticket 94): one paid with a beta (sandbox) Payment is a test.
          donations: { where: { paymentStatus: 'confirmed', payments: { none: { sandbox: true } } } },
        },
      },
    },
  });

  if (!campaign) notFound();

  const lifecycleStatus = effectiveStatus(campaign, new Date());
  if (!isPubliclyViewable(lifecycleStatus)) notFound();

  // The rate in force right now (prd-compliance 17) -- resolved the same
  // way POST /api/donations freezes it (Campaign, then Category, then Kind
  // default), so what a Donor sees here is what the next Donation would
  // actually pay. This page is revalidated every 60 seconds, so a rate
  // change reaches it on the same cadence as everything else here.
  const { percentBps: platformFeePercentBps } = await resolvePlatformFeeBasisForCampaign(prisma, campaign);

  // The Escrow Hold length, shown next to the Platform Fee (CONTEXT.md,
  // Escrow Hold; prd-compliance 18). Every Payment freezes its own duration
  // at creation (ESCROW_HOLD_DAYS today -- there is no Admin override per
  // Kind/Category/Campaign yet, unlike Platform Fee), so what is shown here
  // is what the next Donation's Payment would actually freeze.
  const escrowHoldDays = ESCROW_HOLD_DAYS;

  // Progress as the public may see it (counted-payment.ts): sandbox (beta)
  // Payments are taken back out of the stored counter.
  const [{ collectedAmount: collectedAmountForPublic }] = await withCountedCollectedAmount(prisma, [campaign]);

  // "Donasi uji": only while the beta marker is on; null otherwise.
  const testDonationAmount = await testDonationAmountForCampaign(prisma, campaign.id);

  // Transform the data for the client component
  const campaignData = {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    description: campaign.description,
    story: campaign.story,
    coverImage: campaign.coverImage,
    targetAmount: campaign.targetAmount,
    collectedAmount: collectedAmountForPublic,
    testDonationAmount,
    category: campaign.category,
    // Effective, so an Active Campaign past its deadline shows as ended.
    // The Suspension reason is not rendered here: this page is cached for
    // every visitor alike, so the view asks the API for it, which answers
    // only the owning Fundraiser.
    lifecycleStatus,
    isUrgent: campaign.isUrgent,
    isDemo: campaign.isDemo,
    deadline: campaign.deadline ? campaign.deadline.toISOString() : null,
    createdAt: campaign.createdAt.toISOString(),
    creator: campaign.creator,
    donationCount: campaign._count.donations,
    platformFeePercentBps,
    escrowHoldDays,
  };

  return (
    <>
      <StructuredData
        data={{
          '@context': 'https://schema.org',
          '@type': 'DonateAction',
          name: campaign.title,
          description: campaign.description,
          url: publicUrl(`/campaign/${campaign.slug}`),
          recipient: {
            '@type': 'Organization',
            name: campaign.creator.name,
          },
        }}
      />
      <CampaignDetailView campaign={campaignData} />
    </>
  );
}
