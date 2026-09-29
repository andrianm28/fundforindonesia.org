# 38: Penangguhan Volunteer Trip oleh Admin

**Type:** implementation

**Status:** ready-for-agent

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
