# 59: Validasi env produksi (FIELD_*, JOBS_SECRET, NEXTAUTH_URL) dan tombol Google yang tersembunyi bila belum dikonfigurasi

**Type:** hardening (H-2 dalam rencana percepatan full rilis 2026-10-04)

**Status:** done (PR #223, 983ee5d)

**Blocked by:** none

## Konteks

Owner menyetujui rencana percepatan full rilis pada 2026-10-04; tiket ini adalah
H-2 di dalamnya (ukuran S).

`assertProductionEnv` (`src/lib/env-check.ts`, dipanggil dari
`src/instrumentation.ts` hanya di runtime Node saat server start) kini hanya
memeriksa `RATE_LIMIT_SECRET`/`NEXTAUTH_SECRET`. Kekurangan lain gagal diam-diam:

- Tanpa `FIELD_*` aplikasi tidak bisa menulis kontak sama sekali (kolom plaintext
  sudah di-drop, ADR 0012) dan baru menolak pada Donor pertama.
- Tanpa `JOBS_SECRET`, `/api/internal/jobs/run` hanya menjawab 503/401 ke cron.
- `NEXTAUTH_URL` yang salah merusak callback OAuth dan cookie. Produksi kini
  memakai `NEXTAUTH_URL` = apex; galang di-redirect 301 ke apex.

`src/lib/auth.ts` membuat `GoogleProvider` dengan `clientId!` walau env kosong,
dan halaman login selalu menampilkan "Masuk dengan Google" (keputusan C13:
tombol disembunyikan sampai dikonfigurasi).

## Yang dibangun

1. `assertProductionEnv` di produksi juga memvalidasi `FIELD_ENCRYPTION_KEY`,
   `FIELD_ENCRYPTION_KEY_ID`, `FIELD_HMAC_KEY`, `FIELD_HMAC_KEY_ID` (lengkap,
   32 byte, kunci berbeda, id berbeda, lewat `loadFieldKeys`), `JOBS_SECRET`
   (ada, panjang minimal), dan `NEXTAUTH_URL` (URL https publik, bukan localhost
   atau alamat privat). Semua masalah dilaporkan sekali jalan, tanpa menampilkan
   nilai.
2. Build dan tes tidak rusak: pengecekan hanya jalan saat server start di
   produksi; job CI e2e dan smoke test image CD (yang menjalankan bundle
   produksi di localhost) diberi nilai throwaway dan opt-out eksplisit
   `ALLOW_LOCAL_AUTH_URL=1`.
3. `GoogleProvider` hanya didaftarkan bila `GOOGLE_CLIENT_ID` dan
   `GOOGLE_CLIENT_SECRET` terisi; halaman login menyembunyikan tombol Google
   dan pemisah "atau" kecuali `/api/auth/providers` memuat `google`.

## Kriteria penerimaan

- [x] Tes `env-check` merah lalu hijau: tiap variabel `FIELD_*` hilang, kunci
      salah ukuran, kunci sama, `JOBS_SECRET` kosong/pendek, `NEXTAUTH_URL`
      kosong/http/localhost/privat/bukan URL ditolak; env lengkap diterima.
- [x] Non-produksi tidak diblokir; pesan galat tidak memuat nilai rahasia.
- [x] Tes halaman login: tombol Google tampil hanya bila provider ada.
- [x] `next build` tanpa `FIELD_*` tetap lolos; CI e2e dan smoke CD tetap hijau.
- [x] Ratchet lint 193 dan tsc 19 tidak naik.

## Comments

- 2026-10-04: owner menyetujui rencana (H-2). Tiket ditulis koordinator,
  `ready-for-agent`.
- 2026-10-04, branch `claude/rilis-1-59-env-validation`, kode di 49c9e15 (PR belum
  dibuat): `loadFieldKeys` dipakai ulang agar aturan kunci satu sumber; galat
  dikumpulkan dan hanya menyebut nama variabel. `JOBS_SECRET` minimal 16 karakter
  (keputusan builder, naikkan bila owner mau). `NEXTAUTH_URL` ditolak bila bukan
  https, localhost, loopback/privat, IPv6 literal, nama tanpa titik, atau TLD
  `.local/.internal/.lan/.home/.test/.invalid/.example`. `ALLOW_LOCAL_AUTH_URL=1`
  hanya melonggarkan cek host/skema (variabel wajib tetap), di-set hanya di job CI
  e2e dan smoke CD, dan didaftarkan `NOT_PASSED` di tes compose prod. `next build`
  tanpa `FIELD_*` lolos (register tidak jalan saat build). Login: tombol Google
  dan pemisah baru muncul setelah `getProviders()` memuat `google`; gagal fetch =
  tersembunyi. Tes terkait hijau, tsc 19, lint 193 (baseline). Hijau CI e2e dan
  smoke CD belum dibuktikan lokal; dibuktikan oleh CI PR.

- 2026-10-04: done. Squash-merge ke `main` di PR #223 (983ee5d), setelah semua check CI hijau; `awaiting-merge` diganti `done` di PR dokumen ronde C. Kotak terakhir dicentang karena terbukti: check `build` dan `e2e` hijau di PR (wajib untuk merge), dan deploy 53fe2d2 berjalan dengan `assertProductionEnv` lolos serta tombol Google tersembunyi di produksi.
