# 94: Beta: mode di Ledger, simulasi penuh, dan guard go-live

**Status:** awaiting-merge

**Blocked by:** 92 (done, merge #230)

**Ukuran:** XL (pecah per bagian bila perlu; urutan di bawah)

**Catatan:** Kode uang + keamanan + konkurensi. Wajib review independen `sonnet` dengan bukti diposting di PR. TIDAK memakai slot skema: kolom `sandbox` di `LedgerEntry`, `Payout`, `Refund`, `UsageReport` sudah ditambahkan oleh tiket 92 (migrasi `20261005010000_sandbox_mode_columns`) dan belum diisi maupun dibaca. Bila ternyata perlu kolom/indeks lagi, itu satu PR skema baru dan harus menunggu slot.

> **PERINGATAN:** penanda `BETA_SANDBOX` TIDAK boleh diaktifkan di produksi sebelum tiket ini ter-deploy. Sampai 94 live, saldo Campaign, escrow sweep, Payout, Refund, dan Provider Balance masih mencampur uang uji dengan uang nyata; tiket 92 hanya menyaring Payment, bukan jalur Ledger.

## Latar

Keputusan owner 2026-10-04/05 (mengganti sebagian desain tiket 92): data beta ditandai mode sandbox sejak awal dan DIKECUALIKAN PERMANEN dari angka nyata: saldo, Payout, Impact & Transparency, rekap, Dormant. Tidak ada penghapusan data saat go-live. Tiket 92 sudah menandai Payment dan menyaringnya dari total publik serta rekonsiliasi. Tiket ini membawa mode itu ke seluruh Ledger dan turunannya, dan membuat alur uang yang tidak bisa dijalankan dengan sandbox (Payout, Usage Report, Refund) dapat disimulasikan penuh di layar tanpa transfer nyata.

M1 menjadi dua tahap (istilah di `CONTEXT.md`, ditulis koordinator): tahap Beta (uang uji, mode sandbox, simulasi) lalu tahap uang nyata.

## Cakupan

1. **Stamping.** Setiap pembuatan `LedgerEntry`, `Payout`, `Refund`, `UsageReport` mengisi `sandbox` dari mode sumbernya: Payment untuk jurnal settlement/escrow/Refund, Payout untuk jurnalnya, dan seterusnya. Mode berasal dari baris sumber, BUKAN dari env saat itu, sehingga sapuan atau Refund yang terjadi setelah go-live atas Payment beta tetap ber-cap sandbox. Satu fungsi bernama untuk "mode baris ini" di `src/lib/money/`, dipakai semua titik pembuatan (seperti `currentPaymentSandboxStamp` di tiket 92).
2. **Saldo per mode di SEMUA agregat.** Tiap agregat yang menjumlah Ledger atau penghitung memilah per mode; uang nyata tidak pernah tercampur uang uji. Daftar (dari Comments tiket 92):
   - saldo Campaign (`accountBalance`, `src/lib/wallet.ts`, `/api/balance`) dan Trip;
   - sapuan Escrow Hold (`escrow.ts`);
   - kelayakan Payout (`src/lib/money/payouts.ts`, `trip-payout-funds.ts`);
   - Refund (`refunds.ts`, batas Refund, `refund-standing`);
   - Provider Balance dan `providerReconciliation.pots` per penyedia, serta `providerWithdrawals`;
   - rekonsiliasi: `negativeBalances`, `tripNegativeBalances`, dan pemeriksaan saldo ledger lain;
   - rekap dan Impact: garis `payouts` dan `beneficiaries`;
   - `src/lib/money/dormant-balances.ts`;
   - `src/lib/money/manual-contributions.ts`;
   - `donationCount` publik (`_count.donations`) memilah Donation ber-Payment sandbox;
   - penghitung `collectedAmount` mentah di jalur non-publik: `scrutiny.ts`, `abuse-thresholds.ts`, `/akun/kampanye-saya`, `/api/user/campaigns`, `/admin/campaigns`, urutan "Pilihan Kami" di beranda;
   - Payment Trip Fee ber-cap sandbox di panel Trip.
   Cara yang disukai: satu seam per jenis agregat yang menerima mode, bukan `where` tersebar.
3. **Simulasi penuh di layar.** Payout, Usage Report, dan Refund dapat dijalankan end-to-end memakai saldo uji saja, berlabel UJI di setiap layar (Admin, Fundraiser, publik bila tampil), tanpa transfer nyata ke penyedia. Saldo uji tidak pernah dapat dipakai untuk Payout nyata, dan sebaliknya.
4. **Guard.** Startup/readiness menolak kombinasi `BETA_SANDBOX=true` dengan kredensial live (guard Sumopod dari tiket 92 sudah menolak URL live; perluas ke kredensial/mode penyedia lain dan pastikan tidak ada jalur transfer nyata terbuka saat penanda aktif).
5. **Runbook flip beta ke live** di `docs/` (ops, owner yang menjalankan): urutan cabut penanda, isi URL live, pemeriksaan rekonsiliasi bersih, tidak ada penghapusan data. Memuat peringatan di atas.
6. **CONTEXT.md** (koordinator): istilah Beta dan M1 dua tahap. Builder tidak menyentuh berkas ini.

## Acceptance

- [x] Semua pembuatan LedgerEntry/Payout/Refund/UsageReport mengisi `sandbox` dari mode sumbernya (tes per titik pembuatan; mode dibaca dari baris sumber, bukan env)
- [x] Setiap agregat di daftar cakupan 2 memilah per mode; tes dengan data uji dan data nyata sekaligus membuktikan tak ada campuran, di mode beta maupun live
- [x] Payout, Usage Report, dan Refund dapat disimulasikan penuh dengan saldo uji, berlabel UJI, tanpa panggilan transfer ke penyedia (tes membuktikan klien penyedia tidak dipanggil)
- [x] Saldo uji tidak bisa dipakai untuk Payout/Refund nyata dan sebaliknya
- [x] Guard menolak `BETA_SANDBOX=true` bersama kredensial live
- [x] Runbook flip beta ke live ditulis; peringatan "jangan aktifkan penanda di produksi sebelum 94 ter-deploy" tercantum
- [x] Rekonsiliasi Admin bersih untuk campuran data beta dan nyata

## Comments

- 2026-10-05: ditulis koordinator dari keputusan owner 2026-10-04/05. Kolom skema sudah disediakan tiket 92.
- 2026-10-10 (builder): dikerjakan di branch `claude/project-thread-1972n2`, di atas main setelah #230 merge. TIDAK memakai slot skema: tidak ada migrasi baru; kolom `sandbox` dari `20261005010000_sandbox_mode_columns` dipakai apa adanya. Keputusan implementasi:
  - **Seam mode** `src/lib/money/sandbox-mode.ts`: `sandboxModeOf(row)` (mode baris yang sudah ada) dan `currentSandboxStamp()` (baris baru tanpa baris sumber; satu-satunya tempat penanda dibaca untuk cap Ledger). `postTransaction` menerima `sandbox` di `PostOptions` (default false = uang nyata, arah aman); `sandbox-mode.test.ts` memindai semua titik pembuatan `postTransaction` di `src/` dan mewajibkan mereka menyebut `sandbox`.
  - **Sumber mode:** settlement webhook dan sapuan Escrow dari `Payment.sandbox`; Refund dicap dari Payment-nya saat dibuat, jurnal Refund dari `Refund.sandbox`; Payout dicap `currentSandboxStamp()` saat diminta (penanda aktif = simulasi dengan saldo uji, mati = uang nyata), jurnal dan Usage Report dari `Payout.sandbox`. Manual Contribution dicap dari penanda saat disetujui; pembalikannya membaca mode dari entri aslinya, dan uang uji tidak menyentuh penghitung publik `collectedAmount`.
  - **Saldo per mode:** `campaignBalance/escrowBalance/tripBalance/tripEscrowBalance/programBalance/collectionAccountBalance/providerBalances` dan `tripHeldBalance/tripWithdrawableBalance` menerima `sandbox` (default false). Pembaca lain memilah: rekonsiliasi (`negativeBalances`, `tripNegativeBalances`, escrow, fee, manual, stranded, Payout stuck), Impact (garis `payouts`, `beneficiaries`, kolam), `dormant-balances`, `programBooks`, `campaignBlockingUsageReport` (blokir Usage Report hanya antar-Payout semode).
  - **Simulasi:** Payout, Usage Report, dan Refund jalan penuh dengan saldo uji. Modul uang tidak pernah memanggil penyedia (ADR 0006); `sandbox-mode.test.ts` memindai itu dan tes Postgres nyata memata-matai registry penyedia sepanjang siklus. Layar Admin (antrean/detail Payout dan Refund), panel Payout Fundraiser, dan daftar pencairan publik berlabel UJI (`SandboxBadge`).
  - **Ditutup selama penanda aktif** (uang nyata, tidak punya mode sendiri, tanpa skema baru): Pengalihan dana Campaign dan Penarikan dari penyedia.
  - **Guard boot** (`betaSandboxEnvRefusals`, dipanggil `assertProductionEnv`): menolak `BETA_SANDBOX=true` bersama URL Sumopod non-sandbox, juga bila penyedia aktif lain, karena penyedia aktif bisa diganti dari layar Admin tanpa restart. Kredensial live hanya dibedakan lewat host; kode tidak menebak dari teks kunci.
  - **Runbook** `docs/runbooks/beta-ke-live.md`, memuat peringatan jangan aktifkan penanda sebelum 94 ter-deploy.
  - Diteruskan ke koordinator: `CONTEXT.md` (istilah Beta, M1 dua tahap) dan `.env.example` (`BETA_SANDBOX`) belum disentuh builder.
  - Penghitung mentah `Campaign.collectedAmount` dan `donationCount` (`scrutiny.ts`, `/api/user/campaigns`, `/admin/campaigns`, urutan "Pilihan Kami", `donationCount` publik) juga sudah hanya menghitung uang nyata (`withCountedCollectedAmount`, filter `payments: { none: { sandbox: true } }`). Yang sengaja belum: panel Trip tidak punya total Payment Trip Fee sendiri; uang Trip ditutup lewat saldo Trip dan rekap, keduanya terpisah per mode. Guard boot hanya memeriksa URL, bukan API key.
