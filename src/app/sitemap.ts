import { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { sitemapCampaignWhere } from '@/lib/subject-guard';
import { publicUrl } from '@/lib/public-url';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: publicUrl(),
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: publicUrl('/explore/all'),
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: publicUrl('/zakat'),
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: publicUrl('/login'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: publicUrl('/register'),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  // Category pages
  const categories = await prisma.category.findMany({
    select: { slug: true },
  });

  const categoryPages: MetadataRoute.Sitemap = categories.map((cat) => ({
    url: publicUrl(`/explore/${cat.slug}`),
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  // Campaign pages: Active ones, and ended (Expired, Completed) ones whose
  // transparency pages stay findable (CONTEXT.md, Campaign Status).
  const campaigns = await prisma.campaign.findMany({
    where: sitemapCampaignWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });

  const campaignPages: MetadataRoute.Sitemap = campaigns.map((campaign) => ({
    url: publicUrl(`/campaign/${campaign.slug}`),
    lastModified: campaign.updatedAt,
    changeFrequency: 'daily' as const,
    priority: 0.9,
  }));

  return [...staticPages, ...categoryPages, ...campaignPages];
}
