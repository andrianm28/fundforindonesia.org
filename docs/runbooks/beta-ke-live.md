# Runbook: dari Beta ke uang nyata (go-live)

Dijalankan **owner** di host produksi. Agent tidak menyentuh host produksi dan tidak men-dispatch deploy (lihat `CLAUDE.md`). Asal: tiket 94 (`.scratch/rilis-1-benda/issues/94-beta-ledger-mode-and-simulation.md`), keputusan owner 2026-10-04/05. Penanda dan guard Sumopod dari tiket 92.

> **PERINGATAN: jangan aktifkan `BETA_SANDBOX=true` di produksi sebelum tiket 94 ter-deploy.**
> Tanpa 94, saldo Campaign, sapuan Escrow Hold, Payout, Refund, dan Provider Balance masih mencampur uang uji dengan uang nyata. Tiket 92 hanya menyaring Payment, bukan jalur Ledger. Urutan yang benar: deploy kode 94 (penanda masih mati), baru nyalakan penanda.

## Apa yang dimaksud Beta dan live

- **Beta**: `BETA_SANDBOX=true`. Sumopod hanya boleh sandbox (`https://api-pay-sandbox.sumopod.com`). Setiap Payment, entri Ledger, Payout, Refund, dan Usage Report yang lahir di masa ini dicap `sandbox = true`. Payout, Usage Report, dan Refund bisa disimulasikan penuh di layar, berlabel **UJI**, tanpa transfer nyata ke penyedia.
- **Live**: penanda dicabut, URL Sumopod live diisi. Baris yang sudah dicap `sandbox` **dikecualikan permanen** dari saldo, Payout, Impact & Transparency, rekap, dan Dormant. **Tidak ada data yang dihapus.**

Cap diambil dari baris sumbernya (Payment, Refund, Payout), bukan dari penanda saat itu. Jadi sapuan Escrow Hold, Refund, atau penyelesaian yang terjadi setelah go-live atas Payment beta tetap ber-cap sandbox, dan tidak masuk angka nyata.

**Wakaf dan hibah punya saklar sendiri**, terpisah dari Beta: `WAKAF_HIBAH_OPEN`. Bawaannya mati (hanya nilai persis `true` yang membuka), dan selama mati Campaign WAKAF/HIBAH menolak semua donasi. Jangan nyalakan di `.env` produksi sebelum nazhir berizin dan tinjauan syariah tercatat. Mencabut `BETA_SANDBOX` tidak membukanya.

Selama penanda aktif, dua hal ini **ditutup** karena memindahkan uang nyata dan tidak punya mode sendiri: Pengalihan dana Campaign (Campaign Transfer) dan Penarikan dari penyedia (Provider Withdrawal). Keduanya kembali normal setelah penanda dicabut.

## Sebelum mulai

1. Kode tiket 94 sudah ter-deploy, CI hijau, dan `main` berisi migrasi `20261005010000_sandbox_mode_columns`.
2. Cadangan basis data terbaru ada dan bisa dipulihkan (`docs/runbooks/restore.md`).
3. Simpan nilai `.env` produksi sekarang di tempat aman (tanpa menempelkannya ke repo atau chat).

## Urutan

Jalankan berurutan, mulai dari langkah 0. Berhenti di langkah mana pun yang gagal; jangan lanjut.

### 0. Prasyarat hukum

Semua butir di bawah harus terpenuhi **sebelum** langkah 1. Mencabut `BETA_SANDBOX` membuka uang nyata, dan kode hanya menjaga izin per Campaign (`collectingEntityBlock`); tidak ada yang menahan go-live bila prasyarat ini terlewat. Catat siapa yang memeriksa dan tanggalnya di tempat catatan owner (bukan di repo).

1. **Penasihat hukum sudah menyetujui susunan PT dan yayasan** (ADR 0009: operator PT Jaya Korpora Prima memegang akun merchant, Lembaga Mitra menghimpun atas izinnya sendiri per ADR 0010). Persetujuan tertulis dan tanggalnya tercatat.
2. **Syarat & Ketentuan dan Kebijakan Privasi sudah ditinjau penasihat hukum**, dan tanggal "Terakhir diperbarui" di kedua halaman sesudah revisi terakhir. Tinjauan ini mencakup isi UU PDP yang belum ditulis ulang (dasar pemrosesan, transfer lintas negara, pemberitahuan kebocoran).
3. **Minimal satu Lembaga Mitra memegang Izin Penghimpunan yang berlaku**, dan izin UAT palsu (dummy) sudah diakhiri. Periksa:

```sql
SELECT po.name, fp.number, fp.issuer, fp.kinds, fp."validFrom", fp."validTo"
FROM "FundraisingPermit" fp JOIN "PartnerOrganisation" po ON po.id = fp."partnerOrganisationId"
ORDER BY fp."validTo" DESC;
```

   Pastikan ada baris yang `validTo` di masa depan dan nomornya nyata, dan tidak ada baris uji yang masih berlaku.
4. **Tidak ada Kind Authorisation WAKAF atau HIBAH** (keputusan owner: belum ada uang wakaf/hibah sampai nazhir berlisensi dan tinjauan syariah ada). Hasilnya harus nol baris:

```sql
SELECT id, "partnerOrganisationId", kind, "validFrom", "validTo"
FROM "KindAuthorisation" WHERE kind IN ('WAKAF', 'HIBAH');
```

   Bila ada, cabut atau biarkan kedaluwarsa dulu; jangan go-live dengannya.
5. **Tidak ada data seed atau demo yang terlihat publik.** Campaign contoh tidak boleh tampil sebagai nyata:

```sql
SELECT count(*) FROM "Campaign" WHERE "isDemo" = false AND "collectingEntityId" IS NULL;
```

   Harus nol, dan halaman `/explore/all` serta `/impact` tidak menampilkan Campaign atau angka contoh.
6. **Alamat email kontak aktif**: kotak surat umum dan kotak surat privasi (nilainya di `src/lib/site-identity.ts`) benar-benar menerima email.
7. **Pengaturan Laman Publik di produksi sudah bersih.** Default baru di kode hanya berlaku bila belum ada baris `SiteSetting`; baris yang sudah tersimpan tetap memuat teks lama. Buka Admin, Pengaturan Laman Publik, dan pastikan tidak ada nomor telepon, alamat, atau klaim ("jutaan orang") contoh.

### 1. Bekukan donasi sementara (opsional, disarankan)

Belum ada tombol pembekuan donasi; cara praktisnya, jadwalkan go-live di jam sepi dan umumkan jeda singkat. Pastikan tidak ada Payment baru yang masuk selama penggantian. Cek tidak ada Payment `PENDING` yang masih hidup:

```sql
SELECT id, "sandbox", status, "createdAt" FROM "Payment" WHERE status = 'PENDING' ORDER BY "createdAt";
```

Payment sandbox yang masih `PENDING` boleh dibiarkan kedaluwarsa. Webhook yang datang terlambat tetap memakai cap Payment-nya (sandbox).

### 2. Periksa rekonsiliasi di mode Beta

Masuk sebagai Admin, buka `GET /api/admin/reconcile`. Harus bersih untuk uang nyata:

- `unbalancedTransactions` kosong.
- `negativeBalances` dan `tripNegativeBalances` kosong.
- `mismatches` kosong.

Laporan ini hanya menghitung uang nyata. Data beta tidak muncul di sana kecuali di antrean Refund (ditandai `sandbox`).

Bila tidak bersih, **berhenti** dan selidiki dulu. Jangan go-live di atas angka yang tidak cocok.

### 3. Selesaikan atau biarkan antrean uji

Payout, Refund, dan Usage Report uji yang masih menggantung dikecualikan dari angka nyata. Pertama cek bahwa tidak ada **uang nyata** yang menggantung:

```sql
SELECT status, count(*) FROM "Payout" WHERE "sandbox" = false GROUP BY status;
SELECT status, count(*) FROM "Refund" WHERE "sandbox" = false GROUP BY status;
```

Cek juga Refund yang belum final (`AWAITING_DONOR_DETAILS`, `PROCESSING`) dan Payout `DRAFT`/`PENDING` ber-cap sandbox. **Tolak atau selesaikan Payout dan Refund sandbox yang masih menggantung sebelum go-live**: setelah rekening nyata dipakai, Payout sandbox yang masih `DRAFT` tidak boleh disetujui. Server menegakkannya: `approvePayout`, `completePayout`, `approveRefund`, dan `completeRefund` menolak baris ber-cap sandbox begitu `BETA_SANDBOX` dicabut (409 `SANDBOX_ROW_IN_LIVE_MODE`). Cara menutupnya, di halaman Admin Payout (`/admin/payouts/[id]`): Payout `DRAFT` dengan tombol **Tolak Payout** (`POST /api/admin/payouts/[id]/reject`, alasan wajib, tidak ada jurnal), Payout `APPROVED` dengan **Tandai gagal** (`POST /api/admin/payouts/[id]/fail`, alasan wajib, memposting jurnal cermin `payout-failed-<id>` yang mengembalikan dana dari `PAYOUT_CLEARING` ke saldo). Refund sandbox ditolak lewat `PATCH /api/campaigns/[slug]/refunds/[id]/reject` (`REQUESTED`) atau `.../fail` (`APPROVED`).

```sql
SELECT status, count(*) FROM "Payout" WHERE "sandbox" = true AND status NOT IN ('COMPLETED','REJECTED','FAILED') GROUP BY status;
SELECT status, count(*) FROM "Refund" WHERE "sandbox" = true AND status NOT IN ('COMPLETED','REJECTED','FAILED') GROUP BY status;
```

Hasil dua query pertama (uang nyata) harus kosong atau hanya berisi status akhir (`COMPLETED`, `REJECTED`, `FAILED`). Sebelum go-live biasanya memang kosong, karena belum ada uang nyata.

### 4. Ganti URL dan kredensial Sumopod ke live

Di `.env` produksi:

1. Isi `SUMOPOD_BASE_URL` dengan URL live.
2. Isi `SUMOPOD_API_KEY` dan `SUMOPOD_WEBHOOK_SECRET` dengan kredensial **live**.
3. Pastikan `PAYMENT_PROVIDER=sumopod`.

Guard boot memeriksa URL Sumopod saja, bukan API key; pastikan sendiri kunci yang diisi adalah kunci sandbox selama Beta. Jangan cabut penanda dulu bila kredensial live belum siap: guard boot menolak kombinasi penanda aktif dengan URL live, dan guard Sumopod menolak sandbox saat penanda mati. Dua guard ini sengaja saling mengunci, jadi go-live dilakukan **satu langkah**: cabut penanda dan isi URL live dalam satu penggantian `.env` dan satu restart.

### 5. Cabut penanda dan restart

1. Hapus `BETA_SANDBOX` (atau kosongkan) dari `.env` produksi.
2. Restart stack (owner, lewat prosedur deploy biasa).
3. Cek `GET /api/health` mengembalikan `{ "ok": true }`.

Bila boot gagal, pesan galatnya menyebut nama variabel yang salah (tanpa nilainya). Perbaiki `.env` dan restart; jangan mengembalikan penanda bersama URL live.

### 6. Verifikasi setelah live

1. Banner "Beta, tidak ada uang nyata" hilang dari beranda, konfirmasi donasi, dan Receipt baru.
2. Receipt lama yang Payment-nya ber-cap sandbox tetap memuat catatan beta. Itu disengaja.
3. Halaman Campaign tidak lagi menampilkan baris "Donasi uji", dan progres Campaign hanya uang nyata.
4. Buka `GET /api/admin/reconcile` lagi: harus tetap bersih.
5. Lakukan **satu donasi kecil nyata** milik owner, lalu pastikan:
   - Payment-nya `sandbox = false`;
   - entri Ledger-nya `sandbox = false`;
   - angka muncul di Campaign dan di rekonsiliasi.

```sql
SELECT p."sandbox" AS payment_sandbox, le."sandbox" AS ledger_sandbox, count(*)
FROM "Payment" p JOIN "LedgerEntry" le ON le."paymentId" = p.id
WHERE p."createdAt" > now() - interval '1 hour'
GROUP BY 1, 2;
```

Payment baru harus `false | false`. Baris `true | false` atau `false | true` berarti cap tidak konsisten: **hentikan donasi** dan laporkan.

6. Pastikan baris beta tetap utuh dan terpisah:

```sql
SELECT "sandbox", count(*) FROM "LedgerEntry" GROUP BY "sandbox";
```

## Yang tidak dilakukan

- Tidak ada penghapusan data beta. Data itu tetap ada, ber-cap sandbox, dan tidak masuk angka nyata mana pun.
- Saldo uji tidak bisa dipakai untuk Payout atau Refund nyata, dan sebaliknya. Tidak ada langkah memindahkan saldo uji ke saldo nyata.
- Tidak ada kembali ke Beta di atas data live yang sama. Bila perlu uji lagi, pakai lingkungan lain.

## Bila harus mundur

Mundur hanya aman **sebelum** ada Payment nyata pertama. Setelah itu, jangan menyalakan kembali penanda di basis data yang sama: guard boot akan menolak, dan donasi nyata yang ada tidak boleh bercampur dengan simulasi.

- Sebelum Payment nyata pertama: kembalikan `.env` dari cadangan langkah "Sebelum mulai" (penanda aktif, URL sandbox) dan restart.
- Sesudahnya: perbaiki ke depan (roll forward). Hubungi pengembang dengan hasil `GET /api/admin/reconcile`.

## Pemantauan galat (GlitchTip)

Tiket `.scratch/go-live-ops/issues/04-glitchtip-error-monitoring.md`. Dijalankan owner.

1. Di GlitchTip, buat project (platform Node/Next.js) dan salin DSN-nya.
2. Isi `SENTRY_DSN=<dsn>` di `.env` produksi (bukan `NEXT_PUBLIC_`, jangan ke repo atau chat), lalu restart app lewat alur deploy biasa. Kosong berarti tidak ada pelaporan.
3. Verifikasi: picu galat uji, mis. buka URL yang memicu galat server (atau, di browser, jalankan `fetch('/api/client-error',{method:'POST',body:JSON.stringify({name:'TestError',message:'uji pemantauan'})})` di konsol). Dalam beberapa detik, isu `TestError` harus muncul di GlitchTip; periksa bahwa tidak ada email, nomor rekening, atau token di dalamnya.
4. Kesehatan lebih dalam: `GET /api/health/deep` (503 bila DB mati; jumlah Payment `PENDING` lebih dari 24 jam). `/api/health` tetap ringan untuk CD. Usia eksekusi terakhir pekerjaan terjadwal belum dicatat di mana pun, jadi belum dilaporkan.
