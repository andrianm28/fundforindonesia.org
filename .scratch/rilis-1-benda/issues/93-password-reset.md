# 93: Lupa password: reset lewat tautan email

**Type:** task (fitur keamanan; wajib sebelum beta publik)

**Status:** awaiting-merge

**Blocked by:** none

Disetujui owner pada 2026-10-05 ("tambahkana fitur lupa pass"). Owner memutuskan tiket ini dibangun di sesi VPS, sebagai pengecualian sekali atas aturan cloud-only di `CLAUDE.md`.

## Konteks

- App tidak punya alur reset password sama sekali: tidak ada route `lupa`, `forgot`, atau `reset` di `src/app`. Dua akun Admin produksi kehilangan passwordnya dan hanya bisa dipulihkan lewat langkah ops di host.
- SMTP Sumopod aktif di produksi sejak 2026-10-05 (login SMTP terverifikasi), jadi email reset bisa terkirim.
- PR #230 (mode beta sandbox) sedang memakai slot skema, dan aturan proyek hanya mengizinkan satu PR skema pada satu waktu. Karena itu desain ini **sengaja tanpa skema**.

## Desain

- **Token stateless**, ditandatangani HMAC-SHA256 dengan kunci turunan dari `NEXTAUTH_SECRET`, dengan pemisah domain `fund-for-indonesia:password-reset:v1`.
  - Isi yang ditandatangani: id user, waktu kedaluwarsa, sidik jari hash password saat ini, dan `emailHmac`.
  - Masa berlaku 60 menit.
  - Token **otomatis sekali pakai**: begitu password berganti, sidik jarinya berubah dan semua token lama mati. Mengganti email juga mematikannya.
- **Permintaan** `POST /api/auth/password-reset` `{ email }`:
  - Jawabannya selalu generik dan identik, ada akun atau tidak, supaya tidak ada enumerasi email.
  - User dicari lewat `emailHmac`, karena email disegel (ADR 0012).
  - Email dikirim hanya bila akunnya ada.
  - Rate limit per alamat klien dan per `emailHmac`.
- **Konfirmasi** `POST /api/auth/password-reset/confirm` `{ token, password }`:
  - Password divalidasi dengan `password-schema`, dan token diverifikasi constant-time.
  - Hash memakai cost 12 lewat `password-hash.ts`.
  - `emailVerifiedAt` diisi bila masih kosong, karena tautan email membuktikan kendali atas alamat itu.
  - Rate limit.
- **Sesi lama:** callback JWT menyimpan sidik jari hash password saat sign-in. Kalau sidik jari di DB berbeda, sesi itu tidak berlaku lagi. Callback memang sudah membaca user dari DB.
- **Halaman:**
  - `/lupa-password`;
  - `/reset-password`, dengan `Referrer-Policy: no-referrer` seperti `/akun/verifikasi-email`;
  - tautan "Lupa password?" di `/login`.
- **Email:** template berbahasa Indonesia di `src/lib/mail/password-reset.ts`, polanya mengikuti `email-verification.ts`.

## Acceptance criteria

- [x] Email terdaftar menerima tautan reset. Email tak terdaftar mendapat jawaban yang sama persis, tanpa enumerasi.
- [x] Token ditolak bila kedaluwarsa (lebih dari 60 menit), diubah, atau dipakai ulang setelah password berganti.
- [x] Password baru memenuhi `password-schema` (minimal 8 karakter) dan di-hash dengan cost 12.
- [x] Setelah reset, sesi lain milik user itu tidak berlaku.
- [x] Rate limit berlaku pada permintaan dan konfirmasi.
- [x] Tidak ada email, token, atau password yang tercatat di log.
- [x] Tanpa migrasi dan tanpa env var baru.
- [x] Ada tes unit dan tes route, dan tautan sudah dipasang di halaman login.

## Comments

### 2026-10-05, builder (branch `claude/rilis-1-93-password-reset`, sha: lihat commit HEAD cabang itu)

Dibangun test-first sesuai desain, tanpa skema, migrasi, atau env var baru.

- `src/lib/password-reset.ts`: token stateless (kunci turunan `fund-for-indonesia:password-reset:v1`; sidik jari = SHA-256 atas hash password sekarang dan `emailHmac`; timingSafeEqual). Klaim sesi `pwf` = HMAC berkunci turunan, 16 hex.
- `POST /api/auth/password-reset`: batas per alamat klien (10/jam) dan per kunci lookup email (3/jam), keduanya fail-closed dan sebelum lookup/mail. Jawaban 200 identik. Email dikirim **tanpa di-await** supaya waktu respons tidak membedakan akun ada atau tidak.
- `POST /api/auth/password-reset/confirm`: batas 20/jam per klien (fail-open: tidak mengirim email). Tulisan `updateMany` dijaga pada hash lama dan `emailHmac` yang diverifikasi token, jadi dua pengiriman serentak satu tautan hanya satu yang berhasil. `emailVerifiedAt` diisi hanya bila kosong.
- `src/lib/auth.ts`: callback jwt membandingkan `pwf` dengan DB. Token lama tanpa `pwf` di-upgrade. Sesi yang diakhiri kehilangan `id` dan assignments, dan callback session mengembalikan `{}` (getServerSession jadi null).
- Halaman `/lupa-password`, `/reset-password`, tautan "Lupa password?" di `/login`, header `Referrer-Policy: no-referrer` untuk `/reset-password`.

Sengaja tidak diubah / catatan untuk reviewer:
- `src/app/akun/pengaturan/page.tsx`: ditambah `signOut` setelah ganti password berhasil. Alasannya akibat langsung dari klaim `pwf`: `PATCH /api/user/password` juga mengganti hash, jadi sesi pengguna itu sendiri berakhir pada request berikutnya; tanpa ini ia keluar tanpa penjelasan. Route `PATCH` tidak diubah.
- `src/proxy.ts` tidak diubah. Middleware membaca cookie JWT mentah tanpa callback, jadi cookie lama bisa lolos matcher sampai cookie ditulis ulang; semua halaman/route yang memakai `getServerSession` (termasuk layout admin dan moderasi) sudah memperlakukannya sebagai keluar.
- Efek samping: akun yang hash passwordnya di-rehash saat login (ADR 0017, biaya di bawah 12) kehilangan sesi lain sekali.
- Batas per email 3/jam berarti pihak lain bisa menghabiskan jatah permintaan seseorang selama satu jam (mereka tidak bisa membaca emailnya). Kompromi yang disengaja demi mencegah banjir inbox.
- `mail_not_configured` dicatat oleh `sendReportingFailure` dengan `userId` dan teks error (nama variabel env), bukan email atau token.
- Tes: `password-reset.test.ts`, `mail/password-reset.test.ts`, kedua `route.test.ts`, `auth.test.ts` (klaim, upgrade token lama, Google), tiga halaman `(auth)`, `next-config.test.ts`.
