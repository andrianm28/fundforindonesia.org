# 54: GET /api/volunteer-trips mengembalikan fundraiserId; tripFeeAmount menerima desimal tanpa batas; coverImage menerima URL apa saja

**Type:** implementation (keamanan, data integrity)

**Status:** awaiting-merge

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan tiga celah pada respons API dan validasi input: (1) respons GET publik memuat field internal Trip, (2) `tripFeeAmount` kurang divalidasi, dan (3) `coverImage` kurang divalidasi.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #177 untuk perbaikan.

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

## Comments

- 2026-10-02: awaiting-merge. PR #177, commit b9330b0. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
