# 39: Verifikasi identitas Fundraiser pada pengajuan Trip pertama

**Type:** implementation

**Status:** ready-for-agent

**Blocked by:** none

## Why

CONTEXT.md (Fundraiser): Verifier "memverifikasi identitas Fundraiser pada
pengajuan pertamanya", untuk Campaign maupun Volunteer Trip. `decideVerificationRequest`
membuat `IdentityVerification` pada persetujuan pertama Campaign
(`src/lib/campaign-lifecycle.ts`), tetapi `decideTripSubmission`
(`src/lib/volunteer/trip.ts`) tidak melakukannya. Owner 2026-09-29, grilling tiket 29 dan `prd-audit/issues/10` (putaran 1 dan 2, "ya semua"): tiket kecil tersendiri,
tidak memblokir layar utama.

## Scope

- `decideTripSubmission` membuat `IdentityVerification` pada persetujuan pertama
  Trip milik seorang Fundraiser yang belum pernah terverifikasi, dengan aturan
  yang sama seperti jalur Campaign (satu per Fundraiser, tidak dobel bila Campaign
  sudah memverifikasinya, dan sebaliknya).
- Tes dua arah: Trip lalu Campaign, dan Campaign lalu Trip.

## Acceptance

- Tidak ada perubahan skema. Tidak menyentuh kode uang.
