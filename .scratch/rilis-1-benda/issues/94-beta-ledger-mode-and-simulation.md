# 94: Beta: mode di Ledger, simulasi penuh, dan guard go-live

**Status:** ready-for-agent

**Blocked by:** 92

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

- [ ] Semua pembuatan LedgerEntry/Payout/Refund/UsageReport mengisi `sandbox` dari mode sumbernya (tes per titik pembuatan; mode dibaca dari baris sumber, bukan env)
- [ ] Setiap agregat di daftar cakupan 2 memilah per mode; tes dengan data uji dan data nyata sekaligus membuktikan tak ada campuran, di mode beta maupun live
- [ ] Payout, Usage Report, dan Refund dapat disimulasikan penuh dengan saldo uji, berlabel UJI, tanpa panggilan transfer ke penyedia (tes membuktikan klien penyedia tidak dipanggil)
- [ ] Saldo uji tidak bisa dipakai untuk Payout/Refund nyata dan sebaliknya
- [ ] Guard menolak `BETA_SANDBOX=true` bersama kredensial live
- [ ] Runbook flip beta ke live ditulis; peringatan "jangan aktifkan penanda di produksi sebelum 94 ter-deploy" tercantum
- [ ] Rekonsiliasi Admin bersih untuk campuran data beta dan nyata

## Comments

- 2026-10-05: ditulis koordinator dari keputusan owner 2026-10-04/05. Kolom skema sudah disediakan tiket 92.
