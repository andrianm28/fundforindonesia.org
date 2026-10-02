# 54: GET /api/volunteer-trips mengembalikan fundraiserId; tripFeeAmount menerima desimal tanpa batas; coverImage menerima URL apa saja

**Type:** implementation (keamanan, data integrity)

**Status:** in-review

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
   Attacker bisa submit `tripFeeAmount: 999999999.99` untuk overflow atau
   calculation error.

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

## Hasil (in-review)

- **(a) selesai.** Allow-list `select` ada di `src/lib/volunteer/trip-public.ts`
  dan dipakai GET `/api/volunteer-trips` dan GET `/api/volunteer-trips/[slug]`
  (Trip dan Batch OPEN-nya). Aman untuk publik, daftar: id, slug, title,
  description, coverImage, destination, tripFeeAmount, createdAt. Detail
  menambah story, itinerary, status. Batch: id, tripId, startDate, endDate,
  registrationDeadline, maxQuota, status (+ `remainingQuota` dihitung).
  Tidak pernah: fundraiserId, updatedAt, Batch minQuota/timestamp. Tidak ada
  field khusus Volunteer terautentikasi di dua route ini (keduanya publik).
  Klien diperiksa: tidak ada klien yang memanggil GET kedua route ini
  (TripForm hanya POST/PATCH dan membaca `slug`; halaman publik membaca DB
  langsung). POST/PATCH tetap mengembalikan baris Trip ke pemiliknya sendiri.
- **(b) selesai.** `tripFeeAmount`: bilangan bulat, positif, maks
  `MAX_RUPIAH_AMOUNT` (2_147_483_647, batas ledger/kolom Int) di POST dan
  PATCH (bukan 500 juta dari saran awal: mengikuti batas yang sudah ada).
- **(c) coverImage: ditangani PR #173** (`src/lib/cover-image.ts`); tidak
  dikerjakan di tiket ini.
