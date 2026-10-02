# 55: PATCH /api/registrations/[id] menjawab 403 vs 404 mengungkap keberadaan ID; registrations/mine 500 untuk input tidak valid

**Type:** implementation (keamanan, API quality)

**Status:** awaiting-merge

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan dua celah pada endpoint registrasi: (1) respons PATCH Registration membedakan kasus tak berizin dan tak ada sehingga membocorkan informasi, dan (2) `GET /api/registrations/mine` menjawab 500 untuk input query tidak valid.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #175 untuk perbaikan.

## Scope

- **lockRegistration** di `src/lib/volunteer/trip.ts`:
  - Update guard logic: jika Registration tidak ada OR tidak punya akses, throw
    error yang di-handle sebagai 404 (bukan 403).
  - Alternatif: tangkap exception dalam route dan convert semua auth/not-found error
    ke 404 sebelum response.

- **GET /api/registrations/mine** di `src/app/api/registrations/mine/route.ts`:
  - Validasi `page` query parameter: gunakan `z.coerce.number().int().positive().default(1)`.
  - Jika invalid, return 400 Bad Request dengan message deskriptif.
  - Atau gunakan Zod schema untuk parse searchParams.

## Acceptance

- Tes: PATCH ke Registration ID yang tidak ada atau bukan milik Volunteer return 404,
  tidak 403.
- Tes: GET /api/registrations/mine?page=abc return 400 dengan error message, tidak 500.
- Tes: Workflow normal (page=1, page=2, dll.) tetap bekerja.

## Comments

- 2026-10-02: awaiting-merge. PR #175, commit 283aa99. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
