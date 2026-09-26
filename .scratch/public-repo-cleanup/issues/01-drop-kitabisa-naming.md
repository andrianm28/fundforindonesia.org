# 01: Drop the Kitabisa naming from the public tree

**What to build:** Nothing in the shipped code, tests or seed names or links to
Kitabisa. The public tree reads as Fund for Indonesia.

**Blocked by:** none

**Status:** done (PR #40, 4e42858)

- [ ] `package.json` `name` is `fundforindonesia`; `package-lock.json` is regenerated with npm, not by hand (and `bun.lock` is regenerated or removed if nothing uses bun)
- [ ] `src/components/home/AboutSection.tsx` is deleted (dead: nothing imports it, and it links to Kitabisa's real social accounts); `git grep AboutSection` finds nothing
- [ ] `prisma/seed.ts` accounts use `@fundforindonesia.test`, and the seed never prints a password
- [ ] Test fixtures in `ShareModal.test.tsx`, `SEOHead.test.tsx`, `seo.test.ts` and `QuickActionTiles.test.tsx` use `fundforindonesia.org` and the Fund for Indonesia name
- [ ] Comments naming Kitabisa in `src/app/page.tsx`, `FeaturedCampaigns.tsx`, `NewCampaigns.tsx` and `Skeleton.tsx` are reworded or removed
- [ ] `.kiro/specs/kitabisa-clone/` carries a short README (or a header note) saying it is historical and superseded by `CONTEXT.md` and `docs/adr/`
- [ ] `git grep -il kitabisa -- ':!.scratch' ':!.kiro'` finds nothing, or only lines that are explicitly history
- [ ] CI is green; the ratchet baselines are not raised (dropping a file may lower the lint count: lower the baseline in the same PR if `ci/ratchet.mjs` asks for it)
