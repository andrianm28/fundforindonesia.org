import createNextIntlPlugin from 'next-intl/plugin';

// Report-only for now (go-live-ops 05): violations show in the browser
// console before anything is enforced. Next's own bootstrap is inline, hence
// 'unsafe-inline' for scripts until enforcement brings nonces (G5). Covers
// take any https URL, hence img-src https:. Google sign-in redirects through
// a form post, hence form-action accounts.google.com.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
].join('; ');

// Pages whose URL carries a secret token: no Referer leaves them, and they
// stay out of search engines even if a link to one is published.
const TOKEN_PAGE_HEADERS = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // No X-Powered-By: Next.js header; it only tells a scanner what the stack is.
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  // Native addon (ADR 0019): keep it out of the webpack bundle so Node loads the
  // prebuilt .node binary at runtime; Next's standalone trace still copies it.
  serverExternalPackages: ['@node-rs/bcrypt'],
  // The image optimizer stays off (ci-cd-github-actions ticket 15 upgraded
  // Next past the release that fixed GHSA-2xp9-vwfh-vxw4, an AVIF-triggered
  // RCE in Next 14.2.35's optimizer, but turning the optimizer back on is a
  // separate decision, not required by that fix). With unoptimized,
  // /_next/image answers 404 and <Image> renders its src as-is. A host
  // allowlist would not do: campaign and trip cover images accept any https
  // URL, and even same-origin /uploads files only have their MIME type
  // checked by the client's claim.
  images: {
    unoptimized: true,
  },
  // Q1 (ADR 0024): eleven Indonesian URLs were renamed. The old URL answers
  // 308 (permanent: true) to the new one, keeping the dynamic segment and the
  // query string. This is Indonesian only and does not depend on the English
  // gate. Mirrors INDONESIAN_RENAMES in src/i18n/pathnames.ts (redirects.test.ts
  // keeps the two equal). /en/explore/all and the other English spellings are
  // not matched here: the proxy maps those to the renamed pages. Redirects run
  // before the proxy, so /explore/<unknown> becomes /jelajah/<unknown>, where
  // the proxy answers 404. /explore/all comes first so the static page is not
  // read as a Category.
  async redirects() {
    return [
      { source: '/explore/all', destination: '/jelajah/semua', permanent: true },
      { source: '/explore/:category', destination: '/jelajah/:category', permanent: true },
      { source: '/campaign/:slug/donate', destination: '/campaign/:slug/donasi', permanent: true },
      { source: '/search', destination: '/cari', permanent: true },
      { source: '/about', destination: '/tentang-kami', permanent: true },
      { source: '/careers', destination: '/karir', permanent: true },
      { source: '/press', destination: '/media', permanent: true },
      { source: '/help', destination: '/bantuan', permanent: true },
      { source: '/contact', destination: '/kontak', permanent: true },
      { source: '/terms', destination: '/syarat-dan-ketentuan', permanent: true },
      { source: '/privacy', destination: '/kebijakan-privasi', permanent: true },
    ];
  },
  // The email-confirmation link carries its token in the query string and the
  // page needs no session. Sending no Referer keeps that token from leaking to
  // anything the page loads or links to (prd-compliance 23).
  // Rules are applied in order and a later rule's header replaces an earlier
  // one with the same key, so the site-wide rule comes first.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          // No includeSubDomains: other hosts under the domain are not this app's call.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          { key: 'Content-Security-Policy-Report-Only', value: CONTENT_SECURITY_POLICY },
        ],
      },
      { source: '/receipt/:token', headers: TOKEN_PAGE_HEADERS },
      { source: '/akad-wakaf/:token', headers: TOKEN_PAGE_HEADERS },
      { source: '/sertifikat/:code', headers: TOKEN_PAGE_HEADERS },
      {
        source: '/akun/verifikasi-email',
        headers: TOKEN_PAGE_HEADERS,
      },
      {
        // The reset link carries a signed token in its query string (rilis-1 93).
        source: '/reset-password',
        headers: TOKEN_PAGE_HEADERS,
      },
      // The same pages under /en (ADR 0024). Header rules match the URL as
      // requested, before the proxy maps /en/<path> to the page, and the
      // certificate page has its English spelling here.
      ...[
        '/en/receipt/:token',
        '/en/akad-wakaf/:token',
        '/en/certificate/:code',
        '/en/sertifikat/:code',
        '/en/akun/verifikasi-email',
        '/en/reset-password',
      ].map((source) => ({ source, headers: TOKEN_PAGE_HEADERS })),
    ];
  },
};

// ADR 0024: foundation only; the request config pins the locale to 'id'.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
