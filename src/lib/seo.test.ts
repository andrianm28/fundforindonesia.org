import { describe, it, expect } from 'vitest';
import { generateSEOMetadata, generateStructuredData, SEOProps } from './seo';

describe('generateSEOMetadata', () => {
  const baseProps: SEOProps = {
    title: 'Bantu Anak Yatim',
    description: 'Donasi untuk anak yatim di seluruh Indonesia',
    url: '/campaign/bantu-anak-yatim',
  };

  it('generates full title with site name', () => {
    const metadata = generateSEOMetadata(baseProps);
    expect(metadata.title).toBe('Bantu Anak Yatim - Fund for Indonesia');
  });

  it('sets description', () => {
    const metadata = generateSEOMetadata(baseProps);
    expect(metadata.description).toBe('Donasi untuk anak yatim di seluruh Indonesia');
  });

  it('generates canonical URL from base URL and path', () => {
    const metadata = generateSEOMetadata(baseProps);
    expect(metadata.alternates?.canonical).toBe('https://fundforindonesia.com/campaign/bantu-anak-yatim');
  });

  it('generates openGraph metadata with default type website', () => {
    const metadata = generateSEOMetadata(baseProps);
    expect(metadata.openGraph).toEqual({
      title: 'Bantu Anak Yatim',
      description: 'Donasi untuk anak yatim di seluruh Indonesia',
      url: 'https://fundforindonesia.com/campaign/bantu-anak-yatim',
      siteName: 'Fund for Indonesia',
      type: 'website',
    });
  });

  it('generates twitter card metadata with summary_large_image', () => {
    const metadata = generateSEOMetadata(baseProps);
    expect(metadata.twitter).toEqual({
      card: 'summary_large_image',
      title: 'Bantu Anak Yatim',
      description: 'Donasi untuk anak yatim di seluruh Indonesia',
    });
  });

  it('includes image in openGraph when provided', () => {
    const metadata = generateSEOMetadata({
      ...baseProps,
      image: 'https://example.com/campaign.jpg',
    });
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: 'https://example.com/campaign.jpg', width: 1200, height: 630 }],
    });
  });

  it('includes image in twitter when provided', () => {
    const metadata = generateSEOMetadata({
      ...baseProps,
      image: 'https://example.com/campaign.jpg',
    });
    expect(metadata.twitter).toMatchObject({
      images: ['https://example.com/campaign.jpg'],
    });
  });

  it('uses article type when specified', () => {
    const metadata = generateSEOMetadata({
      ...baseProps,
      type: 'article',
    });
    expect(metadata.openGraph).toMatchObject({ type: 'article' });
  });

  it('does not include images fields when image is not provided', () => {
    const metadata = generateSEOMetadata(baseProps);
    expect((metadata.openGraph as Record<string, unknown>)?.images).toBeUndefined();
    expect((metadata.twitter as Record<string, unknown>)?.images).toBeUndefined();
  });
});

describe('generateStructuredData', () => {
  it('serializes object to JSON string', () => {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'DonateAction',
      name: 'Bantu Anak Yatim',
    };
    const result = generateStructuredData(data);
    expect(result).toBe(JSON.stringify(data));
  });

  it('handles nested objects', () => {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Kitabisa',
      address: { streetAddress: 'Jakarta', country: 'ID' },
    };
    const result = generateStructuredData(data);
    expect(JSON.parse(result)).toEqual(data);
  });
});
