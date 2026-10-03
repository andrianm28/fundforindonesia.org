# 44: Grant and revoke assignments from the admin panel (UI)

**What to build:** `src/app/admin/users/page.tsx` currently has a role-change dropdown and nothing else — no way to see or change someone's Verifier/Admin assignments. This ticket adds that surface: an Admin can see a user's current assignments and grant or revoke each one, calling the API ticket 42 builds.

**Blocked by:** 42

**Status:** done (PR #190, 2ca8c0c)

- [x] The admin user list or detail view shows each user's current assignments (Verifier, Admin), not just their Role
- [x] An Admin can grant or revoke a specific assignment from this view, calling ticket 42's API
- [x] The grant/revoke audit trail (who, when) ticket 42 records is visible somewhere reachable from this page — at minimum on the user whose assignments changed
- [x] Loading and error states match the existing role-change dropdown's pattern in the same file, rather than inventing a new one

**Context:** split from ticket 42 during that ticket's `/specflow:spec-to-plan` pass, matching the existing API/UI split between tickets 27 (Payout completion API) and 28 (Fundraiser Payout UI). Ticket 42 is backend-only on purpose — this ticket is the surface an Admin actually uses.

## Comments

- 2026-10-02, branch `claude/prd-44-assignment-audit`: AC 1, 2, 4 already held on main (`src/app/admin/users/page.test.tsx`: shows assignments, grants/revokes through the assignments route, alert-on-error pattern). AC 3 added: `GET /api/admin/users/[id]/assignments` (ADMIN via `withAssignmentCheck`, already registered in `roles-expand-guard.test.ts`) returns `assignmentAuditTrail()` from `src/lib/assignments.ts`, newest first (`actedAt desc`; who = `actedByName`, when = `actedAt`). The page has a per-row "Riwayat" toggle that loads it lazily (spinner, alert on error, empty state). Tests: route (401, 403 for Verifier, order and fields), service, page. Keputusan owner 2026-10-03: urutan terbaru-dulu (`actedAt desc`) tetap, tidak diubah.
- 2026-10-03, branch `claude/prd-44-assignment-audit`: ditambah tes revoke lalu 403 lewat seam publik,
  `src/app/api/admin/users/[id]/assignments/revoke-takes-effect.test.ts` (membuktikan AC 3 tiket 42, yang kini
  `wontfix`). `DELETE /api/admin/users/[id]/assignments` yang asli menulis ke tabel `UserAssignment` in-memory;
  `getServerSession` menjalankan callback `jwt` dan `session` asli dari `authOptions` (pembacaan assignment segar
  tiap request) dengan token login lama yang tidak dibangun ulang. Hasil: Verifier yang di-revoke mendapat 403 di
  `GET /api/moderasi/bank-accounts` (sebelumnya 200), Admin yang di-revoke mendapat 403 di
  `GET /api/admin/users/[id]/assignments` (sebelumnya 200), dan user dengan dua assignment hanya kehilangan yang
  di-revoke.
- 2026-10-03: done. Merge ke main sebagai 2ca8c0c.
