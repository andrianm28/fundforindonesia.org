import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { CampaignDetailView } from '@/components/campaign/CampaignDetailView';
import { StructuredData } from '@/components/shared/SEOHead';
import { effectiveStatus } from '@/lib/campaign-lifecycle';
import { isPubliclyViewable } from '@/lib/campaign-visibility';

// ISR: one render per Campaign, cached for every visitor alike and
// revalidated every 60 seconds. So this page never reads the session, and an
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

  const canonicalUrl = `https://fundforindonesia.com/campaign/${slug}`;

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
          donations: { where: { paymentStatus: 'confirmed' } },
        },
      },
    },
  });

  if (!campaign) notFound();

  const lifecycleStatus = effectiveStatus(campaign, new Date());
  if (!isPubliclyViewable(lifecycleStatus)) notFound();

  // Transform the data for the client component
  const campaignData = {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    description: campaign.description,
    story: campaign.story,
    coverImage: campaign.coverImage,
    targetAmount: campaign.targetAmount,
    collectedAmount: campaign.collectedAmount,
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
  };

  return (
    <>
      <StructuredData
        data={{
          '@context': 'https://schema.org',
          '@type': 'DonateAction',
          name: campaign.title,
          description: campaign.description,
          url: `https://fundforindonesia.com/campaign/${campaign.slug}`,
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
