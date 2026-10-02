# 55: PATCH /api/registrations/[id] menjawab 403 vs 404 mengungkap keberadaan ID; registrations/mine 500 untuk input tidak valid

**Type:** implementation (keamanan, API quality)

**Status:** awaiting-merge

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02) menemukan dua celah pada endpoint registrasi: (1) respons PATCH Registration membedakan kasus tak berizin dan tak ada sehingga membocorkan informasi, dan (2) `GET /api/registrations/mine` menjawab 500 untuk input query tidak valid.

Detail teknis eksposur disimpan owner di luar repo publik; lihat PR #175 untuk perbaikan.

## Scope

- PATCH /api/registrations/[id] return 404 untuk semua kasus tak berizin atau tak ada (tidak membedakan kedua kasus)
- GET /api/registrations/mine validasi query parameter dan return 400 untuk input tidak valid

## Acceptance

- Tes: PATCH ke Registration ID yang tidak ada atau bukan milik Volunteer return 404,
  tidak 403.
- Tes: GET /api/registrations/mine?page=abc return 400 dengan error message, tidak 500.
- Tes: Workflow normal (page=1, page=2, dll.) tetap bekerja.

## Comments

- 2026-10-02: awaiting-merge. PR #175, commit 283aa99. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
