# 50: Seat-hoarding tanpa batas: holdRegistration bisa menahan banyak Batch tanpa pembayaran

**Type:** implementation (keamanan)

**Status:** needs-triage

**Blocked by:** PR #161

## Why

Audit keamanan baca-saja alur Volunteer Trip (2026-10-02, `origin/main` 0f827b1)
menemukan celah pada mekanisme hold registrasi. Fungsi `holdRegistration`
(`src/lib/volunteer/trip.ts:745-783`) membuat HOLD selama 30 menit tanpa pembayaran,
dan route registrations bisa dipanggil berkali-kali oleh satu akun untuk menahan
banyak Batch sekaligus (seat-hoarding).

Skenario serangan (Volunteer nakal, banyak Batch tersedia):

1. Volunteer `POST /api/volunteer-trips/[slug]/batches/[id]/registrations` untuk
   membuat HOLD di Batch A, B, C, D, ... tanpa batasan jumlah aktif.
2. Setiap HOLD menghabiskan seat dan mengunci registrasi untuk Volunteer lain
   selama 30 menit.
3. Volunteer tidak melakukan pembayaran, HOLD otomatis hangus, tetapi dapat
   mengulangi step 1 (rate limit tidak ada).
4. Akibat: seat hilang, Volunteer lain tidak bisa registrasi, Fundraiser kehilangan
   pendapatan.

## Scope

- Implementasi batasan: satu akun Volunteer boleh memiliki maksimal **satu** HOLD
  aktif di seluruh Trip (atau Batch?), dipilih dengan owner.
- Jika Volunteer mencoba membuat HOLD kedua saat sudah ada yang aktif, tolak dengan
  error deskriptif (misal: "Anda sudah memiliki registrasi yang ditahan. Selesaikan
  pembayaran atau tunggu hingga waktu tunggu habis").
- Implementasi rate limit menggunakan `consumeRateLimit` dari PR #161 setelah merge.
  Rate limit mencegah spam `POST` dari IP/Volunteer yang sama dalam interval singkat.
- Update di bawah lock Trip -> Batch -> Registrations (urutan `trip.ts` header).

## Acceptance

- Tes: Volunteer dengan HOLD aktif menolak `POST` registrasi baru; HOLD yang sudah
  hangus tidak menghalangi HOLD baru.
- Tes: Rate limit mencegah pembuatan HOLD berturut-turut dalam interval singkat
  (misal: < 1 detik).
- PR #161 sudah merge sebelum PR ini.
