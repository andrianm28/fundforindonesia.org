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
  // The email-confirmation link carries its token in the query string and the
  // page needs no session. Sending no Referer keeps that token from leaking to
  // anything the page loads or links to (prd-compliance 23).
  async headers() {
    return [
      {
        source: '/akun/verifikasi-email',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
      {
        // The reset link carries a signed token in its query string (rilis-1 93).
        source: '/reset-password',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

export default nextConfig;
