import { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { sitemapCampaignWhere } from '@/lib/subject-guard';
import { publicUrl } from '@/lib/public-url';
import { englishEnabled } from '@/i18n/gate';
import { pairedLocalePath } from '@/i18n/locale-path';

type Entry = MetadataRoute.Sitemap[number];

/**
 * One sitemap row for an Indonesian page. With the English gate open and a
 * paired English page in the pathnames map (ADR 0024 section 2), the row
 * carries `alternates.languages` (id plus en) and the English page gets a row
 * of its own, so each language lists the other (Q2). With the gate closed
 * there is no /en URL and no alternates: the output is the Indonesian site
 * alone.
 */
function pages(path: string, rest: Omit<Entry, 'url' | 'alternates'>): Entry[] {
  const idUrl = publicUrl(path === '/' ? '' : path);
  const enPath = englishEnabled() ? pairedLocalePath(path, 'en') : null;
  if (!enPath) return [{ url: idUrl, ...rest }];
  const enUrl = publicUrl(enPath);
  const alternates = { languages: { id: idUrl, en: enUrl } };
  return [
    { url: idUrl, ...rest, alternates },
    { url: enUrl, ...rest, alternates },
  ];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    ...pages('/', { lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 }),
    ...pages('/jelajah/semua', { lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 }),
    ...pages('/program', { lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 }),
    ...pages('/kolaborasi-csr', { lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 }),
    ...pages('/wakaf', { lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 }),
    ...pages('/hibah', { lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 }),
    ...pages('/login', { changeFrequency: 'monthly', priority: 0.3 }),
    ...pages('/register', { changeFrequency: 'monthly', priority: 0.3 }),
  ];

  // Category pages
  const categories = await prisma.category.findMany({
    select: { slug: true },
  });

  const categoryPages: MetadataRoute.Sitemap = categories.flatMap((cat) =>
    pages(`/jelajah/${cat.slug}`, { lastModified: new Date(), changeFrequency: 'daily', priority: 0.7 }),
  );

  // Campaign pages: Active ones, and ended (Expired, Completed) ones whose
  // transparency pages stay findable (CONTEXT.md, Campaign Status).
  const campaigns = await prisma.campaign.findMany({
    where: sitemapCampaignWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });

  const campaignPages: MetadataRoute.Sitemap = campaigns.flatMap((campaign) =>
    pages(`/campaign/${campaign.slug}`, {
      lastModified: campaign.updatedAt,
      changeFrequency: 'daily',
      priority: 0.9,
    }),
  );

  return [...staticPages, ...categoryPages, ...campaignPages];
}
