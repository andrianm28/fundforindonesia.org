# 34: Layar moderasi Verifier untuk pengajuan Volunteer Trip

**Type:** implementation

**Status:** ready-for-agent

**Blocked by:** none

## Why

`POST /api/moderasi/volunteer-trips/...` meloloskan atau menolak pengajuan Trip,
tetapi tak ada layar yang memakainya: Trip berstatus `SUBMITTED` tidak terjangkau
siapa pun. Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): satu tiket per layar.

## Scope

- Halaman di `/moderasi/volunteer-trips` (dijaga penugasan VERIFIER seperti
  halaman moderasi lain): antrean Trip `SUBMITTED`, dan halaman detail yang
  menampilkan isi Trip yang dibekukan selama diperiksa.
- Meloloskan atau menolak dengan alasan (wajib saat menolak). Verifier tidak
  pernah memutuskan Trip miliknya sendiri; tampilan hanya memberi petunjuk, server
  yang menegakkan.
- Tautan nav di sidebar dan bar mobile `src/app/moderasi/layout.tsx` dengan tes
  nav; halaman didaftarkan di `roles-expand-guard.test.ts` bila memakai
  `withAssignmentCheck` atau `hasAssignment`.
- `export const dynamic = 'force-dynamic'`.

## Acceptance

- Tes halaman untuk daftar kosong, daftar berisi, dan detail; tes bentuk body
  yang dikirim sama persis dengan yang dibaca rute.
- Identity Verification pada pengajuan pertama bukan bagian tiket ini (tiket 39).
