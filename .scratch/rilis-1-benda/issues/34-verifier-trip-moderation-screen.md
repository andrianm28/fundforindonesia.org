# 34: Layar moderasi Verifier untuk pengajuan Volunteer Trip

**Type:** implementation

**Status:** in-review

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

## Implementation note (branch `claude/ticket-34-trip-moderation`)

- Halaman: `src/app/moderasi/volunteer-trips/page.tsx` (antrean `SUBMITTED`, terlama dulu) dan `[id]/page.tsx` (isi Trip, Batch, panel keputusan), keduanya dijaga `hasAssignment(VERIFIER)` dan `force-dynamic`; `[id]/TripDecisionPanel.tsx` mengirim `PATCH /api/moderasi/volunteer-trips/[id]` dengan body persis `{ action: 'approve' | 'reject' }` dan menampilkan teks penolakan server apa adanya. Petunjuk "Trip milik Anda sendiri" hanya petunjuk; `decideTripSubmission` yang menegakkan. Nav di sidebar dan bar mobile, dengan tes nav; kedua halaman didaftarkan di `roles-expand-guard.test.ts`.
- **Selisih dengan Scope**: tiket meminta alasan wajib saat menolak, tetapi rute hanya membaca `action` dan `decideTripSubmission` mencatat `reason: null`. Sesuai batasan (tanpa perubahan skema atau logika), layar tidak punya kolom alasan; alasan penolakan Trip butuh tiket lanjutan yang mengubah rute dan `VolunteerTripStatusChange.reason`. Keputusan owner diperlukan.
- Tes: `npx vitest run src/app/moderasi src/__tests__/properties/roles-expand-guard.test.ts` (81 lulus). Ratchet: `node ci/ratchet.mjs`, lint 193, tsc 47.
- Tinjauan sendiri (`code-review`, dua sumbu dikerjakan satu agen karena subagent tak bisa men-dispatch): Standards bersih; Spec: hanya selisih alasan penolakan di atas.
