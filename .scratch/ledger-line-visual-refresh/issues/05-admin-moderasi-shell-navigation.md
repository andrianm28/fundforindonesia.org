# 05: Admin/moderasi shell — real navigation

**What to build:** An Admin or Verifier logging into the admin/moderasi area
sees real navigation entries for the routes that have an actual index page,
instead of every route being reachable only by typing its URL directly. This
is a visual-system completion, not a new feature — it surfaces routes that
already exist. Apply the new brand colors/typography (ticket 01) to this shell
at the same time, for consistency.

**Blocked by:** 01

**Status:** awaiting-merge

- [ ] The real current admin/moderasi route set is audited first —
      `/admin/campaigns`, `/admin/users`, `/moderasi/campaigns`,
      `/moderasi/reports`, and any others — to determine which have a genuine
      index page worth a nav entry, following the same reasoning `ffi`'s own
      plan used (a route reached only from another page's own queue, keyed by
      an id, with no index route of its own, does not get a nav entry) rather
      than assuming the count or specific four routes from `ffi`'s own route
      set carry over unchanged.
- [ ] Nav entries are added to the admin/moderasi shell for every route that
      qualifies, styled with the new brand colors/typography from ticket 01.
- [ ] No status counts or other data-dependent nav content is added — `ffi`'s
      own plan explicitly dropped this (it would need new API calls, out of
      scope for a visual refresh) after an earlier draft mistakenly promised
      it; this ticket does not reintroduce that mistake.
- [ ] Verified in-browser, logged in as an Admin and separately as a Verifier:
      every route each role can actually reach has a working nav entry, and no
      entry appears for a route that role can't access.

## Audit dan bukti

- Audit rute: `src/components/admin/AdminSidebar.tsx` (13 entri, PR #144/#151)
  dan `src/app/moderasi/layout.tsx` (8 entri, desktop + mobile). Rute
  `[id]`/`[slug]`/`new` tanpa halaman indeks tidak dapat entri. Tanpa hitungan
  data pada nav.
- Sisa yang dikerjakan: shell masih memakai abu-abu polos (admin) dan hex biru
  lama `#0073E6` (moderasi). Kini memakai token `primary`/`ink`; tanpa
  `ledger`. Tes: `AdminSidebar.test.tsx`, `moderasi/layout.test.tsx`.
- Kriteria 4 terverifikasi in-browser pada 2026-10-02 (Chromium headless,
  build produksi `next build` + `next start`, Postgres lokal dengan data seed
  dan kredensial dummy lokal). Akses per peran dijaga layout (ADMIN /
  VERIFIER), bukan nav.
  - Admin, `/admin`, 1280px dan 390px (menu "Buka menu" terbuka): 13 entri
    sidebar terlihat, semuanya HTTP 200 tanpa 404 dan tanpa redirect.
  - Verifier, `/moderasi`, 1280px dan 390px: 8 entri, semuanya HTTP 200 tanpa
    404. Tidak ada tautan `/admin*` di shell; `/admin` oleh Verifier
    dialihkan ke `/`.
  - Tidak ada entri yang rusak. Tangkapan layar tidak di-commit.
- Rute yang dikecualikan dari nav (tidak punya halaman indeks sendiri, hanya
  dicapai dari antrean halaman lain):
  - `/admin/manual-contributions/new`, `/admin/refunds/new`: formulir yang
    dibuka dari tombol di halaman daftarnya.
  - `/admin/manual-contributions/[id]`, `/admin/payouts/[id]`,
    `/admin/refunds/[id]`, `/admin/campaigns/lifecycle/[slug]`: detail per id
    dari baris antrean induknya.
  - `/moderasi/campaigns/[id]`, `/moderasi/volunteer-trips/[id]`: detail dari
    antrean `/moderasi/campaigns` dan `/moderasi/volunteer-trips`.
- Warna: semua hex/gray lama diganti token config (`border-border`, `bg-bg`,
  `bg-bg-secondary`, `text-text`, `text-text-secondary`, `primary`, `ink`).
  Hover dan state aktif sama di kedua shell (`bg-primary/10`, aktif
  `text-primary font-semibold` plus `aria-current="page"` dari `usePathname`,
  rute paling spesifik menang). Kontras `primary` pada tint 10%: 4,53:1 (AA).
  Tanpa `ledger`.
- Tipografi: spec tidak meminta perubahan untuk shell, jadi register sans
  (Inter) tetap. Register Record (Newsreader/JetBrains Mono) dilarang di nav.
- Verifikasi browser (kriteria 4): screenshot sudah dikirim ke owner, tidak
  di-commit.

## Comments

- 2026-10-02: awaiting-merge. PR #183, commit 41ec5aa. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
