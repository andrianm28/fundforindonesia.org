# 22: Upgrade dotenv 17 to 18 (Dependabot #11)

**What to build:** `dotenv` ^17.4.2 is only loaded through `import 'dotenv/config'`
in `prisma/seed.ts` and `prisma.config.ts`. Check the 18.0 changelog for
behaviour changes (log output, override rules, `.env` lookup), upgrade, and
close Dependabot PR #11 in favour of this one (or merge #11 itself if it is
green and nothing else changes).

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `dotenv` 18.x; `npx prisma generate` and the `migrations` CI job still read `DATABASE_URL`
- [ ] Nothing in seed or Prisma config output leaks environment values
- [ ] CI green
