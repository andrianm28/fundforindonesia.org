/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
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
};

export default nextConfig;
