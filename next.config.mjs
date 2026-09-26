/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // The image optimizer stays off until Next is upgraded (ticket 15): Next
  // 14.2.35 can be driven to remote code execution by an AVIF sent through
  // /_next/image (GHSA-2xp9-vwfh-vxw4). With unoptimized, /_next/image answers
  // 404 and <Image> renders its src as-is. A host allowlist would not do:
  // campaign and trip cover images accept any https URL, and even same-origin
  // /uploads files only have their MIME type checked by the client's claim.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
