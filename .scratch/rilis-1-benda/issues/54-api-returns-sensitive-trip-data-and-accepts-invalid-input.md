# 54: GET /api/volunteer-trips terekspos fundraiserId; tripFeeAmount/coverImage tanpa validasi

**Type:** implementation (keamanan, data integrity)

**Status:** needs-triage

**Blocked by:** none

## Why

Audit keamanan menemukan tiga celah pada API: (1) GET response terekspos fundraiserId untuk ID enumeration, (2) tripFeeAmount tidak ada batas atas dan bisa overflow, (3) coverImage menerima HTTP/file/data URL yang tidak aman.

Detail teknis disimpan owner di luar repo publik.

## Scope

- GET /api/volunteer-trips hanya return field publik, tanpa fundraiserId
- tripFeeAmount validasi integer dengan batas maksimum bisnis
- coverImage validasi HTTPS URL saja

## Acceptance

- Tes: GET response tanpa fundraiserId
- Tes: POST/PATCH menolak tripFeeAmount > batas atau non-integer
- Tes: POST/PATCH menolak coverImage HTTP/file/data URL
- Dokumentasi: field yang boleh di-expose ke public
