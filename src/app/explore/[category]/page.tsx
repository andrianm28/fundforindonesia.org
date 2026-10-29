import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { withCountedCollectedAmount } from '@/lib/money/counted-payment';
import { listableCampaignWhere } from '@/lib/subject-guard';
import { CampaignGrid } from '@/components/campaign/CampaignGrid';
import type { CampaignCardData } from '@/types/campaign';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ category: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;

  const categoryRecord = await prisma.category.findUnique({
    where: { slug: category },
  });

  if (!categoryRecord) {
    return { title: 'Kategori Tidak Ditemukan - Fund for Indonesia' };
  }

  return {
    title: `${categoryRecord.name} - Fund for Indonesia`,
    description: `Temukan campaign ${categoryRecord.name} di Fund for Indonesia. Donasi untuk membantu sesama.`,
  };
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params;

  // Verify category exists
  const categoryRecord = await prisma.category.findUnique({
    where: { slug: category },
  });

  if (!categoryRecord) {
    notFound();
  }

  // Fetch campaigns for this category
  const campaigns = await prisma.campaign.findMany({
    where: { ...(await listableCampaignWhere(prisma, new Date())), category },
    include: {
      creator: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 24,
  });

  // Progress as the public may see it (counted-payment.ts): sandbox (beta)
  // Payments are taken back out of the stored counter.
  const publicCampaigns = await withCountedCollectedAmount(prisma, campaigns);

  // Map to CampaignCardData format
  const mappedCampaigns: CampaignCardData[] = publicCampaigns.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    coverImage: c.coverImage,
    collectedAmount: c.collectedAmount,
    targetAmount: c.targetAmount,
    category: c.category,
    deadline: c.deadline,
    isUrgent: c.isUrgent,
    isDemo: c.isDemo,
    creator: {
      name: c.creator.name,
    },
  }));

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-bold text-text mb-1">{categoryRecord.name}</h1>
      <p className="text-sm text-text-secondary mb-4">
        {campaigns.length} campaign
      </p>
      <CampaignGrid
        campaigns={mappedCampaigns}
        variant="standard"
        emptyMessage="Belum ada campaign di kategori ini"
      />
    </div>
  );
}
