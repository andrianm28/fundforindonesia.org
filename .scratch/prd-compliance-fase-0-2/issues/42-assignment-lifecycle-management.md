# 42: Grant and revoke assignments as their own action (API)

**What to build:** An Admin can grant or revoke someone's Verifier or Admin assignment directly, as an explicit API action independent of their Role. UI is ticket 44 — this ticket is the backend only, matching the same API/UI split the Payout tickets (27/28) already established. Today nothing in the application writes or deletes a `UserAssignment` row — the only assignment grants that exist anywhere are the one-off ticket-06 backfill migration and `prisma/seed.ts`. `PATCH /api/admin/users/[id]/role` changes `user.role` and never touches assignments, so demoting an admin through the product does not revoke their access to payout approval, reconciliation, or moderation, and promoting someone to ADMIN gives them a "role changed" notification with zero actual access. This is a genuine gap between ticket 06 (which created the assignment model) and ticket 07 (which switched access decisions over to it) — no ticket anywhere owns granting or revoking one.

**Blocked by:** 6

**Status:** ready-for-agent

- [ ] An Admin can grant a specific assignment (Verifier, Admin) to a user as its own action, independent of changing their Role
- [ ] An Admin can revoke a specific assignment from a user as its own action, independent of changing their Role
- [ ] Revoking a user's last Admin assignment while they hold no other path to the ADMIN-gated routes actually removes their access on the very next request — no caching, no stale session window beyond the existing per-request session refresh
- [ ] `PATCH /api/admin/users/[id]/role` is explicitly NOT changed to auto-sync assignments on role change. ADR 0005's entire point is that Verifier and Admin are independent of Role, not derived from it — auto-syncing would quietly recouple them. This ticket adds a deliberate, separate grant/revoke surface instead.
- [ ] A test proves that demoting a user's Role alone does not touch their assignments, and that only the new grant/revoke action does
- [ ] The two-person rule does not apply to granting or revoking an assignment (this is an Admin-only administrative action, distinct from the money-moving two-person actions); record who granted or revoked it and when
- [ ] Recording who/when is additive: a new audit-log model for grant/revoke events, not a rework of `UserAssignment`'s existing composite-key, current-membership-only shape. `UserAssignment` stays exactly as ticket 06/07 shipped it — same rows, same `[userId, assignment]` primary key, same plain `DELETE` on revoke, same query shape `auth.ts`'s session refresh already relies on. Nothing already merged and reviewed gets reworked.

**Context — how this was found:** flagged as Critical in ticket 07's final whole-branch review (Opus), independently verified by the controller before merge (`grep -rn "userAssignment\." src/` returns zero hits outside tests/generated; `admin/users/[id]/role/route.ts` confirmed to only write `role`). The reviewer's own framing: "the blocker is not in the diff — it is what the diff's absence of a companion makes true." Ticket 07 merged with this gap open and tracked here, by explicit decision, rather than held pending this ticket.

**Design note:** the reviewer considered "sync assignments transactionally with the role-change route" as a smaller alternative fix. That's rejected above for the ADR-0005 reason stated in the third acceptance criterion — noted here so a future implementer doesn't reach for it as a shortcut without knowing it was already considered and declined.

## Comments

- 2026-10-02, verifikasi (branch `claude/prd-44-assignment-audit`): TIDAK ditandai done; klaim triase haiku tidak terbukti penuh. Pemblokir prd 06 berstatus wontfix (catatan saja). Pemetaan AC ke tes (`src/lib/assignments.test.ts`, `src/app/api/admin/users/[id]/assignments/route.test.ts`, `src/lib/auth.test.ts`; semua hijau):
  - AC 1 grant: sebagian. VERIFIER langsung (terbukti). ADMIN kini dua-orang (propose + confirm, tiket 07/20), bukan grant langsung.
  - AC 2 revoke: terbukti (revokes the assignment, records the audit entry; self-revoke dan last-ADMIN ditolak).
  - AC 3 efek pada request berikutnya: terbukti tidak langsung (`auth.test.ts` "carries the user's current assignments onto the token" membaca assignment segar dari DB tiap refresh); tidak ada tes end-to-end revoke lalu 403.
  - AC 4 role route tidak auto-sync: route `PATCH /api/admin/users/[id]/role` sudah tidak ada (Role dipensiunkan, `retire-role-hierarchy`), jadi AC usang.
  - AC 5 tes "demoting Role alone tidak menyentuh assignment": TIDAK ADA tes; tidak ada kode yang bisa diuji karena route Role sudah dihapus.
  - AC 6 tanpa two-person rule: BERTENTANGAN dengan implementasi; ADMIN grant sengaja dua-orang (tiket 07/20). Siapa/kapan tercatat (AssignmentAuditEntry, terbukti).
  - AC 7 audit log aditif, `UserAssignment` tidak diubah: terbukti (upsert/delete polos di tes).
  Perlu keputusan owner: tutup 42 sebagai superseded oleh 07/20 dengan AC 4-6 direvisi, atau tulis ulang AC.
