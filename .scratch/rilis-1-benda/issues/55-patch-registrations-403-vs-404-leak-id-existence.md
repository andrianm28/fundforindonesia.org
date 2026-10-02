# 55: PATCH /api/registrations/[id] menjawab 403 vs 404 mengungkap keberadaan ID; registrations/mine 500 untuk input tidak valid

**Type:** implementation (keamanan, API quality)

**Status:** ready-for-agent

**Blocked by:** none

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan dua celah pada endpoint registrasi:

1. **Information disclosure via 403 vs 404**: Route `PATCH /api/registrations/[id]`
   mengembalikan 403 Forbidden jika Volunteer tidak punya akses ke ID tersebut
   (`src/lib/volunteer/trip.ts:889`, dalam guard `lockRegistration`). Sebaliknya,
   jika ID tidak ada seharusnya return 404. Attacker bisa enumerate Registration IDs
   dengan mengamati perbedaan response code: 403 = ID ada tapi tidak punya akses,
   404 = ID tidak ada (atau bukan milik endpoint).
   
   Aturan umum: resource yang tidak ada dan yang tidak boleh diakses harus
   tampak sama bagi Volunteer.

2. **registrations/mine crash untuk input tidak valid**: Route `GET /api/registrations/mine`
   dengan parameter `page=abc` (non-numeric) mengembalikan 500
   (`src/app/api/registrations/mine/route.ts:13`, `parseInt` tanpa error handling).
   Seharusnya normalize/validate input dan return 400 Bad Request.

## Scope

- **lockRegistration** di `src/lib/volunteer/trip.ts:889`:
  - Update guard logic: jika Registration tidak ada OR tidak punya akses, throw
    error yang di-handle sebagai 404 (bukan 403).
  - Alternatif: tangkap exception dalam route dan convert semua auth/not-found error
    ke 404 sebelum response.

- **GET /api/registrations/mine** di `src/app/api/registrations/mine/route.ts:13`:
  - Validasi `page` query parameter: gunakan `z.coerce.number().int().positive().default(1)`.
  - Jika invalid, return 400 Bad Request dengan message deskriptif.
  - Atau gunakan Zod schema untuk parse searchParams.

## Acceptance

- Tes: PATCH ke Registration ID yang tidak ada atau bukan milik Volunteer return 404,
  tidak 403.
- Tes: GET /api/registrations/mine?page=abc return 400 dengan error message, tidak 500.
- Tes: Workflow normal (page=1, page=2, dll.) tetap bekerja.

## Comments

- 2026-10-02: ditriase retroaktif oleh koordinator (gap alur: builder di-dispatch saat masih needs-triage); owner menyetujui cakupan lewat "ya" 2026-10-02. Dibangun di PR #175.
