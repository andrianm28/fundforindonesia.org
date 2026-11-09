# 18: Donasi rutin lewat payment link per siklus

**Blocked by:** 17 (slot skema)

**Status:** done

**What to build:** Pasal 4.7, BERSYARAT, owner memutuskan dikerjakan. Donatur berakun mendaftarkan donasi rutin: Campaign atau Program tujuan, nominal (>= minimum), periode (bulanan, 3 bulan, 6 bulan, tahunan), tanggal mulai, status (aktif, dihentikan). Job terjadwal yang sudah ada (/api/internal/jobs/run) menerbitkan tagihan tiap siklus: membuat Donation PENDING biasa + payment link Sumopod lewat jalur pembuatan donasi yang sudah ada (jangan membuat jalur uang baru), lalu mengirim email + notifikasi inbox berisi tautan bayar dan tautan berhenti bertanda tangan. Status siklus: lunas bila Payment PAID lewat webhook yang ada, lewat tempo bila kedaluwarsa. Donatur bisa berhenti dari /akun dan dari tautan email. Tagihan tidak terbit bila tujuan tidak lagi menerima donasi, saklar donasi mati, atau siklus sebelumnya masih tertunda. Tanpa card-on-file. Ganti model lama `AutoDonation` (tidak dipakai) atau hapus dengan migrasi.

- [x] Test penjadwal: satu tagihan per siklus, idempoten bila job jalan dua kali
- [x] Test berhenti lewat tautan bertanda tangan
- [x] Test status lunas/lewat tempo dari webhook
- [ ] Review independen sonnet (uang)

## Comments

- 2026-11-09. Skema: `RecurringDonation` + `RecurringDonationCycle` (unik `(recurringId, cycleIndex)`), `AutoDonation` dihapus dengan migrasi `20261111180000_donasi_rutin` (tak ada kode lain yang memakainya; baris lamanya ikut hilang; seed dan tipe lama dibersihkan).
- Jalur uang tidak baru: pembuatan Donation + charge diekstrak dari `POST /api/donations` ke `createChargedDonation` (`src/lib/money/create-charged-donation.ts`), dipakai route dan job. Webhook tidak diubah; status siklus (lunas/lewat tempo/menunggu) dibaca dari `Donation.paymentStatus` yang ditulis webhook, tidak disimpan.
- Job: fase ke-7 `recurringDonations` di `runScheduledJobs`. Gerbang: env, interlock sandbox, saklar Admin, Campaign masih menerima donasi (`campaignRetryRefusal`), siklus sebelumnya tidak menunggu. Klaim siklus di-insert dulu; hanya siklus yang jatuh tempo sekarang yang ditagih, tidak ada tunggakan massal. Charge ditolak provider: siklus ditutup gagal, tidak diulang pada siklus itu.
- Tautan berhenti: token HMAC terikat id (codec yang sudah ada, kunci turunan `NEXTAUTH_SECRET`, tanpa env baru), berlaku 90 hari; halaman konfirmasi GET tidak mengubah apa pun, tombol POST yang berhenti (pemindai email aman).
- Target hanya Campaign: Program tidak menerima uang daring (CONTEXT.md), jadi tidak ada jalur bayar untuk Program; Campaign wakaf ditolak (perlu ikrar eksplisit tiap donasi).
- Notifikasi inbox mengarah ke `/akun/donasi-rutin` (tautan inbox hanya internal); tautan bayar ada di halaman itu dan di email.
- Tes: `src/__tests__/integration/donasi-rutin-real-db.test.ts` (Postgres nyata, 21 kasus), unit jadwal/token/route. Review: sub-agent tidak tersedia, ditinjau sendiri; review independen sonnet (uang) belum.
