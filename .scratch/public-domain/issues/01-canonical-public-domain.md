# 01: Pick one public domain for every link (.com vs .org)

**What to build:** When `NEXT_PUBLIC_BASE_URL` is unset, public links fall back to `https://fundforindonesia.com`. The places that do this are:
- SEO metadata;
- the sitemap;
- hardcoded links on the Campaign page;
- the verification outcome email, since PR #19.

The repo name, `MAIL_FROM`, the careers and press addresses, and the mail DNS all use `fundforindonesia.org`. The owner decides which domain is canonical. Then:
- one shared base-URL helper replaces the scattered fallbacks;
- the repo variable `NEXT_PUBLIC_BASE_URL`, which is a cd.yml build arg and currently unset, is set to that domain before the cutover (ci-cd 08).

**Blocked by:** None. Decided 2026-09-26: `https://fundforindonesia.org` is canonical (`.com` has no DNS; the cert, nginx and mail are all on .org).

**Status:** done (PR #28, d48e0e9)

- [x] The owner has named the canonical domain: fundforindonesia.org.
- [ ] Every public link, the sitemap, SEO metadata and email links use a single helper.
- [ ] The repo var `NEXT_PUBLIC_BASE_URL` is set.

## Comments

- 2026-09-26: merged in PR #28.
  - `publicUrl()` in `src/lib/public-url.ts` now backs SEO, the sitemap, the Campaign page and the verification email.
  - The build defaults for the Dockerfile and cd.yml moved from galang to the apex.
  - Still open, for the owner:
    - set the repo var `NEXT_PUBLIC_BASE_URL`;
    - set `NEXTAUTH_URL` to the apex in the production `.env` and the repo var, or redirect galang to the apex (ci-cd 08).
