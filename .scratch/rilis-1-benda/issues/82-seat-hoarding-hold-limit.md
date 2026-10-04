# 82: V-1 seat-hoarding-hold-limit

**Status:** needs-info

**Blocked by:** `.scratch/rilis-1-benda/issues/50-seat-hoarding-without-limit.md` (PR #161 merge, mekanisme rate limit); menunggu C16

**Ukuran:** S-M

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet`. Tanpa skema yang diketahui (`RateLimitBucket` sudah ada).

**Menunggu keputusan:** C16 (rekomendasi: maks 2 hold per akun + rate limit; angka pasti disamarkan di tiket ini).

## Latar

Ini tiket build untuk tiket 50. Detail celah sengaja tidak ditulis karena repo publik; builder memintanya ke owner saat tiket tidak lagi terblokir.

## Berkas relevan

- `src/lib/volunteer/trip.ts` (`holdRegistration`; `liveRegistrationWhere` ~baris 515)
- `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts`
- `src/lib/rate-limit.ts`
- `src/__tests__/integration/volunteer-registration-concurrency.test.ts`

## Acceptance

- [ ] Satu akun menahan paling banyak jumlah hold sesuai C16; hold di atas batas ditolak dengan galat domain
- [ ] Rate limit pada pembuatan hold
- [ ] Hold yang kedaluwarsa atau dibayar tidak dihitung ke batas
- [ ] Tes konkurensi Postgres sungguhan: permintaan paralel tidak melewati batas
- [ ] Angka pasti diisi di tiket setelah C16 dijawab; tiket 50 ditandai `done` di PR yang sama

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.
