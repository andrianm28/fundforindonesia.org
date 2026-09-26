/**
 * The canonical public site address, and the one place absolute links to the
 * public site are built: SEO metadata, the sitemap, the Campaign page and
 * email links all go through here.
 *
 * NEXT_PUBLIC_BASE_URL is a build arg (Dockerfile, cd.yml): Next inlines it
 * into the bundles at build time. Unset, it falls back to
 * https://fundforindonesia.org, the domain the cert, nginx and mail are on.
 * Never NEXTAUTH_URL: that is where next-auth runs, not the public address.
 */
export const CANONICAL_PUBLIC_URL = 'https://fundforindonesia.org';

/** The public site address plus `path` (which starts with `/`), with no trailing slash on the base. */
export function publicUrl(path = ''): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || CANONICAL_PUBLIC_URL).replace(/\/+$/, '');
  return `${base}${path}`;
}
