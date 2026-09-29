# 33: Katalog Volunteer Trip publik, detail Trip, dan pemilih Batch

**Type:** implementation

**Status:** in-review

**Blocked by:** none

## Why

Tidak ada halaman katalog Trip, detail Trip, atau pemilih Batch; semua rute API
ada tetapi tak satu pun dipanggil UI. Notifikasi `decideTripSubmission` bahkan
menautkan `/volunteer-trip/<slug>`, halaman yang tidak ada (404). Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): tiket 29
dipecah per layar (33 sampai 37) plus tiket kecil 38, 39, 40.

## Scope

- Katalog publik `/volunteer-trip`: hanya Trip berstatus `ACTIVE` yang punya
  sedikitnya satu Batch `OPEN` sebelum tenggat pendaftarannya. Kartu memuat judul,
  destinasi, Trip Fee, dan tanggal Batch terdekat.
- Detail `/volunteer-trip/[slug]` (rute yang sudah ditautkan notifikasi):
  destinasi, itinerary, cerita, Trip Fee, dan pemilih Batch (tanggal, sisa kursi
  dari kuota maksimum, tenggat pendaftaran). Volunteer yang belum masuk diarahkan
  ke halaman masuk lalu kembali ke halaman ini.
- Tombol "Daftar" di pemilih Batch hanya mengarah ke alur Registration (tiket 36).
  Sampai tiket 36 selesai, tombol itu tidak ditampilkan.
- Tautan menu pendukung "Volunteer" (PRD pasal 3) menunjuk ke katalog ini.
- Halaman yang membaca basis data memakai `export const dynamic = 'force-dynamic'`.

## Acceptance

- Trip `DRAFT`, `SUBMITTED`, `REJECTED`, `SUSPENDED`, `CANCELLED` tidak muncul di
  katalog dan detailnya menjawab 404 bagi publik.
- Tes untuk daftar, detail, dan Batch yang penuh atau lewat tenggat.
- Tidak ada perubahan skema atau kode uang.

## Implementation note (branch `claude/ticket-33-volunteer-catalog`)

- `src/lib/volunteer/catalog.ts`: `listCatalogTrips` and `getTripDetail`, the one
  read behind both pages. Only `ACTIVE` Trips; the catalog needs an `OPEN` Batch
  before its deadline. Seats left count `CONFIRMED` plus unexpired `HOLD`, as
  `holdRegistration` does (a lapsed HOLD is not counted, and nothing is written
  from a render). Each Batch on the detail page is `OPEN`, `FULL` or `CLOSED`.
- `/volunteer-trip` and `/volunteer-trip/[slug]` (both `force-dynamic`); a
  non-`ACTIVE` Trip is `notFound()`. No "Daftar" button (ticket 36).
- Signed-out visitors get a "Masuk" link with `?callbackUrl=`. The login page
  ignored `callbackUrl`, so it now follows it through `safeCallbackUrl`
  (`src/lib/safe-callback-url.ts`, same-site paths only).
- Review rework: `safeCallbackUrl` was a prefix check that `/\t/evil.com` bypassed
  (the URL parser strips tab/CR/LF); it now refuses control characters and
  whitespace, then parses against a dummy origin and returns the parsed path.
  `catalog.ts` reads use `select`, not `include`.
- "Volunteer" link in the Footer "Informasi" list (the support menu; there is
  no other) points at `/volunteer-trip`. The Footer is desktop-only (`lg`), so
  mobile has no entry yet; the homepage tiles deliberately omit Volunteer.
- Tests: `catalog.test.ts`, both page tests, `safe-callback-url.test.ts`, login
  and Footer tests. Ratchet: lint 193, tsc 47.
