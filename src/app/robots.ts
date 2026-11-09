import type { MetadataRoute } from 'next';
import { isCanonicalSite, publicUrl } from '@/lib/public-url';

/**
 * Paths a crawler has no business on: back-office, API, signed-in pages, and
 * pages gated by a token in the URL (Receipt, payment result, Akad Wakaf,
 * Sertifikat). Public pages the sitemap lists (including /login and
 * /register) stay crawlable.
 * robots.txt is a courtesy to crawlers, not access control; the proxy and the
 * pages' own checks remain the gate.
 */
const PRIVATE_PATHS = [
  '/admin',
  '/moderasi',
  '/api',
  '/akun',
  '/donasi-saya',
  '/inbox',
  '/campaign/create',
  '/volunteer-trip/registrasi',
  '/receipt/',
  '/donasi/hasil/',
  '/volunteer-trip/hasil/',
  '/akad-wakaf/',
  '/sertifikat/',
];

export default function robots(): MetadataRoute.Robots {
  // Staging and local dev builds: nothing is crawlable, and no sitemap is
  // advertised that would point crawlers at test content.
  if (!isCanonicalSite()) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
    sitemap: publicUrl('/sitemap.xml'),
    host: publicUrl(),
  };
}
