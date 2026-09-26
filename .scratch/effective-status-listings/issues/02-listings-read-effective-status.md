# 02: Every public listing shows only effectively Active Campaigns

**What to build:** The home page (including the Urgent rail), explore/[category], explore/all and search (through `GET /api/campaigns`), and the zakat campaigns API list only effectively Active Campaigns. The sitemap lists Active, Expired and Completed Campaigns. None of them uses the legacy status string, and none writes anything. See `.scratch/effective-status-listings/spec.md` and CONTEXT.md (Campaign Status).

**Blocked by:** 01

**Status:** done

- [ ] The subject guard provides `listableCampaignWhere(now)` and `sitemapCampaignWhere(now)`, built on the `lifecycleStatus` enum and `deadline`
- [ ] A table test proves that "listable" and "in sitemap" agree with `effectiveStatus` for every stored status × past/future/null deadline
- [ ] All six readers use the helpers. A static test pins that no public listing filters on the legacy `status: 'active'` string
- [ ] Reader tests show that a past-deadline Campaign disappears from the API list, the zakat API and the Urgent query; that Suspended and Cancelled Campaigns appear nowhere; and that ended Campaigns stay in the sitemap
- [ ] Full suite green, tsc adds no errors
