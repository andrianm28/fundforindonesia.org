# 82: V-1 seat-hoarding-hold-limit

**Status:** done

**Blocked by:** `.scratch/rilis-1-benda/issues/50-seat-hoarding-without-limit.md` (PR #161 merge, mekanisme rate limit). C16 dijawab owner 2026-10-04; dispatch hanya setelah 50 `done`.

**Ukuran:** S-M

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet`. Tanpa skema yang diketahui (`RateLimitBucket` sudah ada).

**Keputusan (2026-10-04, ronde C):** C16 batas hold kursi per akun ditambah rate limit (sesuai rekomendasi). Angkanya sengaja tidak dicantumkan di repo publik.

## Latar

Ini tiket build untuk tiket 50. Detail celah sengaja tidak ditulis karena repo publik; builder memintanya ke owner saat tiket tidak lagi terblokir.

## Berkas relevan

- `src/lib/volunteer/trip.ts` (`holdRegistration`; `liveRegistrationWhere` ~baris 515)
- `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts`
- `src/lib/rate-limit.ts`
- `src/__tests__/integration/volunteer-registration-concurrency.test.ts`

## Acceptance

- [x] Satu akun menahan paling banyak jumlah hold sesuai C16; hold di atas batas ditolak dengan galat domain
- [x] Rate limit pada pembuatan hold
- [x] Hold yang kedaluwarsa atau dibayar tidak dihitung ke batas
- [x] Tes konkurensi Postgres sungguhan: permintaan paralel tidak melewati batas
- [x] Angka pasti TIDAK ditulis di repo publik (keputusan C16): owner menyampaikannya ke koordinator, yang meneruskannya lewat brief dispatch; angka hidup di kode atau konfigurasi, bukan di `.scratch`; tiket 50 ditandai `done` di PR yang sama

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C16 dijawab owner sesuai rekomendasi: ada batas hold per akun ditambah rate limit. Angka-angkanya tersamar (anti-abuse) dan tidak ditulis di sini maupun di tiket 50; koordinator mendapatkannya dari owner dan menaruhnya di brief dispatch. Tiket 50 masih `needs-info` sampai PR #161 merge, jadi dispatch menunggu itu. `needs-info` menjadi `ready-for-agent`.

- 2026-10-30: dikerjakan. Batas hold per akun dan rate limit pembuatan hold diputuskan owner (kartu keputusan 2026-10-30); angkanya hanya ada sebagai konstanta bernama di kode (`holdRegistration`, route registrations). Batas dihitung di dalam transaksi `holdRegistration` di bawah advisory lock per akun (setelah lock Batch), hold kedaluwarsa atau dibayar tidak dihitung. Tes konkurensi Postgres sungguhan ditambahkan. Tiket 50 ditandai `done` di commit yang sama.
