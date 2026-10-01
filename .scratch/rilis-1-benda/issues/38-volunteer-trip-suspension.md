# 38: Penangguhan Volunteer Trip oleh Admin

**Type:** implementation

**Status:** done

**Blocked by:** none

## Why

`VolunteerTripStatus.SUSPENDED` ada di enum tetapi tak pernah ditulis: Admin tidak
punya cara menangguhkan Trip, padahal Campaign punya. Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): Q10.

## Scope

- Admin (bukan Verifier) menangguhkan sebuah Trip dengan alasan tercatat dan bisa
  mencabut penangguhannya, mengikuti Suspension Campaign (CONTEXT.md, Suspension).
  Setiap perubahan tercatat di `VolunteerTripStatusChange` (tambah nilai
  `VolunteerTripStatusChangeAction` bila perlu; tetap satu migrasi kecil).
- Selama `SUSPENDED`: tidak ada Registration baru dan tidak ada Payout Trip Fee
  yang disetujui.
- **Tidak ada efek otomatis pada Registration yang sudah ada.** Registration
  `CONFIRMED` tidak dibatalkan dan tidak di-refund otomatis; bila perlu, Admin
  memakai pembatalan Batch (Refund penuh), yang tetap tindakan terpisah.
- Admin tidak pernah menangguhkan Trip miliknya sendiri (di sana ia hanya
  Fundraiser), ditegakkan di server.
- Layar: tombol tangguhkan dan cabut di halaman Admin untuk Trip (mengikuti
  `/admin/campaigns/lifecycle`), tautan nav bila halaman baru, tes nav.

## Acceptance

- Tes untuk setiap larangan di atas dan untuk pencabutan. Review independen
  `sonnet` (aturan peran dan jalur uang Payout).

## Implementation note (branch `claude/ticket-38-trip-suspension`)

Modul: `suspendTrip` dan `liftTripSuspension` di `src/lib/volunteer/trip.ts`
(fungsi baru; `transition` dan `decideTripSubmission` tidak disentuh, jadi
penulisan status + log + notifikasi Fundraiser ada di helper
`writeSuspensionChange` di sebelahnya). Admin saja (`requireAssignmentFor`
sebelum lock, lalu `judgeCapacity`: tidak pernah atas Trip miliknya, 403
`OWN_TRIP_CONFLICT`), alasan wajib (400 `VALIDATION`), hanya dari `ACTIVE`
(409 `TRIP_NOT_SUSPENDABLE`). Pencabutan kembali ke status di baris log
`SUSPENDED` terakhir; tanpa baris itu ditolak (409
`TRIP_SUSPENSION_UNRECORDED`). Log `VolunteerTripStatusChange` (aksi baru
`SUSPENDED`, `SUSPENSION_LIFTED`, capacity ADMIN, dengan alasan) ditulis dalam
transaksi yang sama; migrasi `20260930120000_trip_suspension_actions` hanya
menambah dua nilai enum.

Keputusan yang perlu dikonfirmasi owner: pencabutan mengikuti pola Campaign,
yaitu **Admin yang menangguhkan tidak boleh mencabutnya sendiri**
(`SameAdminLiftError`, 403), karena tiket berkata "mengikuti Suspension
Campaign". Bila owner ingin Admin yang sama boleh mencabut, hapus satu baris
`if (suspension.actorId === actor.userId)` di `liftTripSuspension` dan tes
"refuses the Admin who imposed the latest Suspension".

Registration baru: `holdRegistration` sudah menolak Trip non-`ACTIVE`
(`TripNotTakingRegistrationsError`); ditambah tes yang mengunci perilaku itu
untuk Trip Suspended. Payout: `requirePayoutAllowed` (`src/lib/subject-guard.ts`,
dipanggil `requestPayout`, `approvePayout`, `completePayout`) kini menolak
subjek Trip `SUSPENDED` dengan `PayoutNotAllowedForStatusError` yang sama dengan
Campaign; tidak ada perubahan di `src/lib/money/`. Registration `CONFIRMED`,
Batch, dan Escrow Hold Trip tidak disentuh (pelepasan Escrow Trip tidak
dibekukan; tiket tidak memintanya).

Rute: `POST/DELETE /api/admin/volunteer-trips/[id]/suspension` (`{ reason }`;
otoritas di modul, bukan `withAssignmentCheck`, jadi tidak masuk
`roles-expand-guard`). Layar: `/admin/volunteer-trips` (`force-dynamic`) dengan
`AdminTripSuspensionAction`, tautan nav "Volunteer Trip", tes nav.

Bukti: `npx vitest run src/lib/volunteer src/lib/subject-guard.test.ts
src/lib/money/payouts.test.ts src/app/admin src/components/admin
src/app/api/admin/volunteer-trips src/__tests__/properties`; `node ci/ratchet.mjs`
(lint 193, tsc 47); `npm run ci:local -- migrations` hijau. Tidak ada tes
migrasi terhadap basis data berisi baris: migrasi hanya `ADD VALUE`, dan job
`migrations` sudah menerapkannya dan membandingkan dengan `schema.prisma`; tes
regex atas teks SQL justru yang dilarang `docs/agents/verification.md`.

Rework setelah dua review sonnet: komentar Payout di `payouts.ts` diperbarui (hanya komentar); `liftTripSuspension` memakai tiebreak `id desc` (tes dengan dua baris SUSPENDED berstempel sama); halaman Admin me-redirect tanpa sesi; tes mengunci bahwa Trip Fee yang settle atas HOLD saat Trip Suspended tetap `confirmed` tanpa Refund dan hold expiry tetap berjalan; CONTEXT.md (Suspension, Payout, Registration) diperbarui.
