import { Metadata } from 'next';

export interface SEOProps {
  title: string;
  description: string;
  image?: string;
  url: string;
  type?: 'website' | 'article';
  structuredData?: object;
}

const SITE_NAME = 'Fund for Indonesia';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://fundforindonesia.com';

export function generateSEOMetadata(props: SEOProps): Metadata {
  const { title, description, image, url, type = 'website' } = props;
  const fullTitle = `${title} - ${SITE_NAME}`;
  const canonicalUrl = `${BASE_URL}${url}`;

  return {
    title: fullTitle,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: SITE_NAME,
      type,
      ...(image && { images: [{ url: image, width: 1200, height: 630 }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image && { images: [image] }),
    },
  };
}

export function generateStructuredData(data: object): string {
  return JSON.stringify(data);
}
