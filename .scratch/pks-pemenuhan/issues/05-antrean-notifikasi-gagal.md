# 05: Antrean notifikasi gagal, tandai-selesai webhook, email error ke Admin

**Blocked by:** 04 (slot skema)

**Status:** ready-for-agent

**What to build:** Pasal 8(2) meminta failed notification queue; saat ini kegagalan kirim email hanya `console.error` (src/lib/mail/index.ts). Simpan setiap kegagalan kirim ke tabel antrean (jenis, penerima di-hash/terenkripsi, payload minimal untuk kirim ulang, jumlah percobaan, galat terakhir). Job terjadwal yang sudah ada mencoba ulang dengan backoff sampai batas, lalu menandai gagal permanen. Layar Admin menampilkan antrean dengan tombol kirim ulang. Antrean tinjauan webhook di /admin/reconciliation mendapat tombol 'tandai selesai' dengan catatan (saat ini lewat SQL, docs/runbooks/payment-reconciliation.md:33). Kegagalan webhook dan antrean yang menumpuk mengirim email ringkas ke Admin (maksimal sekali per jam per jenis).

- [ ] Test: kegagalan kirim masuk antrean; retry sukses mengosongkan; batas percobaan
- [ ] Test: tandai selesai webhook tercatat dengan pelaku
- [ ] Test throttle email error
