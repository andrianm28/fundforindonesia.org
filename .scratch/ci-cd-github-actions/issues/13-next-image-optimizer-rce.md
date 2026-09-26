# 13: Close the Next.js image-optimizer RCE (GHSA-2xp9-vwfh-vxw4)

**What to build:** Trivy (ticket 05) found a CRITICAL advisory in next 14.2.35: remote code execution through the image optimizer (sharp/libheif, AVIF input). It **applies to production today**, because `next.config.mjs` allows remote images from any https host (`hostname: '**'`). It is fixed only in Next 15.5.24 or 16.3.3. It is muted in `.trivyignore` until **2026-10-10**, after which the image job fails again.

- **Stopgap now:** limit `images.remotePatterns` to the hosts the app actually loads images from (find them in the code and data), or set `images.unoptimized: true`. Either removes the untrusted path through the optimizer. Remove the `.trivyignore` entry once the stopgap is in, if Trivy still reports it, and keep the entry only with a note of why the stopgap covers it.
- **Proper fix (separate follow-up):** upgrade Next to a fixed release (15.5.24+ or 16.3.3+), with the migration work that implies.

**Blocked by:** None (urgent)

**Status:** done (PR #21, 0c51a20)

- [ ] The optimizer no longer fetches or transforms images from arbitrary hosts, and a test pins the config
- [ ] Every image the app shows still renders (covers, avatars, uploads)
- [ ] The `.trivyignore` entry is gone or justified with an expiry
- [ ] A follow-up ticket for the Next major upgrade exists
