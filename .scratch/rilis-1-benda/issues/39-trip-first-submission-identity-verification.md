# 39: Verifikasi identitas Fundraiser pada pengajuan Trip pertama

**Type:** implementation

**Status:** done

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

## Implementation note (branch `claude/ticket-39-trip-identity-verification`)

The create-once logic moved out of `decideVerificationRequest` into
`recordIdentityVerification` (`src/lib/identity-verification.ts`): a
`createMany` with `skipDuplicates` on the unique `userId`, returning whether it
created the row. The Campaign path calls it with identical arguments, so its
behaviour and tests are unchanged. `decideTripSubmission` calls it only on
`approve`, with the Trip's Fundraiser and the deciding Verifier, inside the
same transaction; it takes no note (the Trip decision has no note field).
Tests in `src/lib/volunteer/trip.test.ts` cover: first Trip approval records
the row; rejection and a refused approval record none; an already verified
Fundraiser keeps the existing row; Trip then Campaign and Campaign then Trip
each leave exactly one row (the second flow is fed the first flow's rows).
`tests/support/in-memory-trip-db.ts` gained `identityVerification.createMany`.
No schema, migration or money code changed.
