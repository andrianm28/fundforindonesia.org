# 04: Status badges read in Indonesian

**What to build:** Since ticket 01, every Campaign status badge uses `STATUS_LABEL`, which holds the glossary names in English (Active, Submitted, Expired…). CONTEXT.md uses those names inside Indonesian sentences, and refusals and notifications should keep using them. Badges, though, are read by Donors and Fundraisers, and they used to show Indonesian words (Aktif, Menunggu, Ditolak, Selesai). Give badges their own Indonesian display map, used only by `CampaignStatusBadge`:

| Status | Badge |
| --- | --- |
| DRAFT | Draf |
| SUBMITTED | Diajukan |
| REJECTED | Ditolak |
| ACTIVE | Aktif |
| SUSPENDED | Dibekukan |
| CANCELLED | Ditarik |
| COMPLETED | Selesai |
| EXPIRED | Berakhir |

`STATUS_LABEL` is unchanged, as is every refusal or notification text that uses it. The status banner on the Campaign page keeps its own sentences.

**Blocked by:** legacy-status-contract 01

**Status:** done

- [ ] One badge label map covers every status; `CampaignStatusBadge` uses it, and nothing else does
- [ ] Badge tests on the Admin list, moderation page and "Kampanye Saya" assert the Indonesian text, including an Active Campaign past its deadline showing "Berakhir"
- [ ] `STATUS_LABEL` and its users are unchanged. Full suite green, tsc adds no errors
