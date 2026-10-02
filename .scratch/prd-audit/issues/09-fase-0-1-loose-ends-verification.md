# 09: Verifikasi kecil Fase 0/1 yang belum ditelusuri detail

**Type:** research

**Status:** resolved

**Blocked by:** —

## Why

Bundel 🟡 dari riset 01: ShareModal (FFI-06) diklaim tak terjangkau halaman
mana pun (belum diverifikasi ulang langsung di kode); pengingat tenggat 7
hari (FFI-03, filenya ada, isinya belum ditelusuri); baris checklist `hibah`
vs `wakaf` (data runtime, bukan kode); pembulatan Platform Fee ke bawah
(belum ditelusuri baris demi baris). Owner 2026-09-28
(`triage-2026-09-28.md` Bagian A, Q3): satu tiket verifikasi gabungan --
keempatnya kemungkinan besar sudah benar dan hanya butuh grep/pembacaan
konfirmasi, bukan pekerjaan baru.

## Question

Untuk masing-masing dari keempat item: baca kode, konfirmasi atau koreksi
klaimnya, catat `file:line` sebagai bukti.

## Answer

Diverifikasi di `origin/main` (0f827b1), 2026-10-02, baca-saja. Dua dari
empat klaim terbukti cacat nyata (tiket 11 dan 12); dua lainnya benar.

### 1. ShareModal (FFI-06): klaim "tak terjangkau" BENAR, tapi alasannya salah

- `ShareModal` hanya didefinisikan di `src/components/shared/ShareModal.tsx:17`
  dan hanya diimpor oleh `ShareModal.test.tsx`. `grep -rn ShareModal src`
  di luar dua berkas itu: nol hasil. Tidak terjangkau dari halaman mana pun.
- Pintu masuknya juga mati: `CampaignCTA` (`CampaignCTA.tsx:12`) tidak
  dirender di mana pun; `CampaignDetail` (`CampaignDetail.tsx:69`, tombol
  `onShare` di `:307`) hanya diimpor oleh `CampaignDetail.test.tsx`.
- Halaman Campaign nyata memakai `CampaignDetailView`
  (`src/app/campaign/[slug]/page.tsx:147`, `not-found.tsx:61`). Tombol
  "Bagikan"-nya (`CampaignDetailView.tsx:254-258`) berkomentar "Share button
  placeholder" dan tidak punya `onClick`.
- Satu-satunya berbagi yang hidup: tombol WhatsApp/Facebook/salin di layar
  sukses donasi (`src/app/campaign/[slug]/donate/page.tsx:461-500`), tanpa X
  dan tanpa parameter `?src=`.
- Koreksi: `CONTEXT.md:83` bilang tidak ada klausa PRD yang meminta berbagi.
  Salah: PRD FFI-06 (`docs/PRD-fund-for-indonesia.md:123`) meminta tombol
  WhatsApp, Facebook, X, salin tautan dan Traffic Source per tautan, Fase 1,
  untuk Fundraiser. `ShareModal` sudah memenuhi isinya (`:34-93`, empat
  kanal, `urlWithSource` di `:29`) tapi tidak tersambung. "Gambar pratinjau
  dari sampul" tidak diperiksa di sini. Lihat tiket 12.

### 2. Pengingat tenggat 7 hari (FFI-03): CACAT, angkanya 3 hari

- Logika ada dan sehat: `src/lib/reminders.ts:59-149`
  (`sendCampaignDeadlineReminders`): Campaign `ACTIVE`, `deadline` dalam
  `(now, now + N hari]`, klaim `updateMany` atas
  `deadlineReminderSentAt: null` (`:99-104`), satu Notification dan satu
  email, tidak berulang. Terjadwal di `src/lib/scheduled-jobs.ts:88-90`;
  pemicunya cron `*/15` ke `/api/internal/jobs/run`
  (`scripts/wizard-track-a.sh:372`).
- `N` = `CAMPAIGN_DEADLINE_REMINDER_DAYS = 3` (`reminders.ts:22`), dengan
  komentar ASSUMPTION `:16-21` bahwa tiket 20 tidak menyebut angka. PRD FFI-03
  (`docs/PRD-fund-for-indonesia.md:120`) menyebut **tujuh hari**. Jadi
  pengingat terkirim 3 hari, bukan 7 hari, sebelum tenggat. Lihat tiket 11.
- Catatan: `src/lib/mail/reminders.ts` hanya templat email, bukan logikanya.

### 3. Baris checklist `hibah` vs `wakaf`: benar dari kode; isi runtime tak terbukti

- Dari kode (benar): hibah punya baris sendiri, bukan berbagi dengan wakaf.
  Seed `prisma/migrations/20260927120000_verification_request_per_kind_and_change_requests/migration.sql:32-34`
  (wakaf) dan `:37-39` (hibah, id `hibah-*`, kind `HIBAH`). Dua koreksi
  sesudahnya: label `hibah-kind-authorisation` menjadi "Kind Authorisation
  hibah" (`20260928040000_hibah_kind_authorisation_label/migration.sql:19-21`),
  dan `hibah-draf-akad` dinonaktifkan
  (`20260928050000_hibah_without_akad_wakaf/migration.sql:41-45`), sesuai
  PRD §4 (hibah tanpa Akad Wakaf). Hasil seed: hibah aktif = dokumen lembaga
  penerima + Kind Authorisation hibah. Pengajuan menyalin item aktif
  `kind = null` atau kind Campaign (`src/lib/campaign-lifecycle.ts:473-488`).
  `src/__tests__/hibah-checklist-seed.test.ts` membaca SQL ini dan mengunci
  hasilnya.
- Tidak bisa dibuktikan dari kode: isi tabel `VerificationChecklistItem` di
  produksi. Data itu dibuat oleh migrasi di atas (lewat `migrate deploy`)
  lalu bisa diubah Admin di `/admin/verification-checklist`
  (`src/app/api/admin/verification-checklist/`), tiap perubahan diaudit di
  `VerificationChecklistAuditEntry`. Baris hasil edit Admin tak terlihat dari
  repo; pengecekan butuh owner membuka panel itu di produksi. Isi dokumen
  hibah sendiri masih placeholder syariah (PRD pasal 14, ADR 0013).

### 4. Platform Fee dibulatkan ke bawah: BENAR

- `src/lib/money/platform-fee.ts:28-36` `floorFeeShare`: `BigInt(amount) *
  BigInt(percentBps) / BigInt(10_000)`, pembagian BigInt memotong ke bawah;
  menolak non-integer dan negatif. `computePlatformFee` (`:50-58`): 0 di
  bawah ambang, selain itu `floorFeeShare`.
- Satu-satunya pemanggil: `src/lib/money/donation-charge.ts:102`; hasilnya
  dibekukan di `Payment.platformFee` (`:113`). Ledger hanya memposting angka
  itu (`ledger.ts:661-663`); tidak ada `Math.round`/`Math.ceil` pada jalur fee.
- Tes: `platform-fee.test.ts:10-31` (2,5% dari 100_001 menjadi 2_500, bukan
  2_501).
- Catatan, bukan cacat: bagian Platform Fee yang dikembalikan saat Refund
  dibulatkan ke atas dan dibatasi total fee (`ledger.ts:567-598`,
  `platformFeePortionFor` `:625`); desain yang disengaja.

### Tiket baru

- `11-deadline-reminder-lead-time.md`
- `12-campaign-share-not-wired.md`
