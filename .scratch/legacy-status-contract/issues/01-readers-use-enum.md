# 01: Every reader of the Campaign status uses the enum

**What to build:** The seven places that still read the legacy `status` string move to `lifecycleStatus`:
- the Verifier queue and count;
- the moderation page and actions;
- the Admin Campaign list;
- `GET /api/user/campaigns` and "Kampanye Saya";
- the `GET /api/campaigns/[slug]` payload;
- the Campaign page.

Badges show the effective status with the Indonesian `STATUS_LABEL`. Payloads drop `status` and carry `lifecycleStatus`. The wrong client type `CampaignStatus` goes. Nothing stops writing the string yet; that is ticket 02. See `.scratch/legacy-status-contract/spec.md`.

**Blocked by:** capacity-judgement 03 (same route file)

**Status:** done

- [ ] The moderation queue and count filter on SUBMITTED, and the actions decide "pending" from the enum
- [ ] Every badge renders from the effective status and `STATUS_LABEL`, including an Active Campaign past its deadline
- [ ] Payloads have no `status` field, and `types/campaign.ts` no longer defines `CampaignStatus`
- [ ] A static test pins that no `src` file outside the lifecycle module reads the Campaign `status` column. Full suite green, tsc adds no errors
