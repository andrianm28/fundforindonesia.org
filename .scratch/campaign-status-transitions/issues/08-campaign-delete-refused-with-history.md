# 08: Deleting a Campaign with status history answers 409, not 500

**What to build:** Since ticket 02, the append-only `CampaignStatusChange` log references its Campaign with `ON DELETE RESTRICT`, so a Campaign that has any status history can no longer be hard-deleted. That is intended: the log is never deleted, and it narrows gap C11 (DELETE bypassing Cancellation). But `DELETE /api/campaigns/[slug]` currently lets the foreign-key failure escape as a 500. The owner or Admin who tries it should get a clear refusal instead: 409 with an Indonesian message saying a Campaign with status history cannot be deleted. Deleting a Campaign without history keeps working exactly as today. Everything else about C11 (whether DELETE should exist at all, pending Donations, the always-404 Admin delete button) is out of scope.

**Blocked by:** 02

**Status:** done

- [x] DELETE on a Campaign that has at least one status-change row answers 409 with an Indonesian message, and nothing is deleted
- [x] DELETE on a Campaign without history behaves as before (same authorization, same success response)
- [x] Unrelated database errors still answer 500. Only the restrict violation from the status-change log is mapped
- [x] Route tests cover the 409 case, the unchanged success case and the unrelated-error case
