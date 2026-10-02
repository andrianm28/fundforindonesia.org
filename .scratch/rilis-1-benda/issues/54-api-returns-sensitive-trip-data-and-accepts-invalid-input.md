# 54: GET /api/volunteer-trips mengembalikan fundraiserId; tripFeeAmount menerima desimal tanpa batas; coverImage menerima URL apa saja

**Type:** implementation (keamanan, data integrity)

**Status:** ready-for-agent

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan tiga celah pada API responses dan validasi input:

1. **fundraiserId terekspos**: Routes `/api/volunteer-trips` dan `/api/volunteer-trips/[slug]`
   mengembalikan seluruh baris Trip termasuk `fundraiserId` di responses
   (`src/app/api/volunteer-trips/[slug]/route.ts:95`,
   `src/app/api/volunteer-trips/route.ts:77`). ID internal Fundraiser seharusnya
   tidak visible ke public atau Volunteer untuk mencegah ID enumeration.

2. **tripFeeAmount menerima desimal tanpa batas atas**: Validasi schema
   (`src/app/api/volunteer-trips/route.ts:13`) hanya check `positive()` tanpa batas
   atas maksimum, padahal kolom database adalah `Int` dengan presisi terbatas.
   Nilai ekstrem atau non-integer bisa lolos validasi.

3. **coverImage menerima skema URL apa pun**: Route tidak memvalidasi bahwa
   `coverImage` adalah URL HTTPS. Bisa menerima HTTP, `file://`, `data:`, atau
   URL pihak ketiga yang tidak terpercaya.

## Scope

- Routes **GET** `/api/volunteer-trips` dan `/api/volunteer-trips/[slug]`:
  - Gunakan `.select()` Prisma untuk mengembalikan hanya field yang diperlukan
    (slug, title, description, startDate, endDate, maxQuota, currentQuota, dll.),
    jangan return `fundraiserId`.
  - Dokumentasikan di bawah field apa yang boleh di-expose untuk public vs
    authenticated Volunteer.

- **PATCH/POST** untuk Trip (routes di `src/app/api/volunteer-trips/...`):
  - Update validasi schema `tripFeeAmount`: `z.number().int().positive().max(500000000)`
    (atau batas maksimum yang sesuai bisnis). Sesuaikan dengan tipe kolom database.
  - Update validasi `coverImage`: `z.string().url().startsWith('https://')` untuk
    enforce HTTPS.

## Acceptance

- Tes: GET responses tidak mengembalikan `fundraiserId`.
- Tes: POST/PATCH menolak `tripFeeAmount` > batas maksimum atau non-integer.
- Tes: POST/PATCH menolak `coverImage` HTTP, `file://`, atau non-URL.
- Dokumentasi: field mana saja yang safe untuk di-expose ke public vs authenticated.

## Comments

- 2026-10-02: ditriase retroaktif oleh koordinator (gap alur: builder di-dispatch saat masih needs-triage); owner menyetujui cakupan lewat "ya" 2026-10-02. Dibangun di PR #177.
