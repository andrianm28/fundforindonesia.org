import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { CampaignDetailView } from '@/components/campaign/CampaignDetailView';
import { StructuredData } from '@/components/shared/SEOHead';
import { effectiveStatus } from '@/lib/campaign-lifecycle';

export const revalidate = 60; // ISR: revalidate every 60 seconds

interface CampaignDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CampaignDetailPageProps): Promise<Metadata> {
  const { slug } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { title: true, description: true, coverImage: true },
  });

  if (!campaign) {
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
          isVerified: true,
          verificationType: true,
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
    status: campaign.status,
    // Effective, so an Active Campaign past its deadline shows as ended.
    // The Suspension reason is not rendered here: this page is cached for
    // every visitor alike, so the view asks the API for it, which answers
    // only the owning Fundraiser.
    lifecycleStatus: effectiveStatus(campaign, new Date()),
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
