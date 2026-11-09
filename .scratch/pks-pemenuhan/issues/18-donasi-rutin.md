# 18: Donasi rutin lewat payment link per siklus

**Blocked by:** 17 (slot skema)

**Status:** ready-for-agent

**What to build:** Pasal 4.7, BERSYARAT, owner memutuskan dikerjakan. Donatur berakun mendaftarkan donasi rutin: Campaign atau Program tujuan, nominal (>= minimum), periode (bulanan, 3 bulan, 6 bulan, tahunan), tanggal mulai, status (aktif, dihentikan). Job terjadwal yang sudah ada (/api/internal/jobs/run) menerbitkan tagihan tiap siklus: membuat Donation PENDING biasa + payment link Sumopod lewat jalur pembuatan donasi yang sudah ada (jangan membuat jalur uang baru), lalu mengirim email + notifikasi inbox berisi tautan bayar dan tautan berhenti bertanda tangan. Status siklus: lunas bila Payment PAID lewat webhook yang ada, lewat tempo bila kedaluwarsa. Donatur bisa berhenti dari /akun dan dari tautan email. Tagihan tidak terbit bila tujuan tidak lagi menerima donasi, saklar donasi mati, atau siklus sebelumnya masih tertunda. Tanpa card-on-file. Ganti model lama `AutoDonation` (tidak dipakai) atau hapus dengan migrasi.

- [ ] Test penjadwal: satu tagihan per siklus, idempoten bila job jalan dua kali
- [ ] Test berhenti lewat tautan bertanda tangan
- [ ] Test status lunas/lewat tempo dari webhook
- [ ] Review independen sonnet (uang)
