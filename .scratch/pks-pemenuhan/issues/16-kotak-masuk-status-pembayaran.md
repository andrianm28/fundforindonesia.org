# 16: Kotak masuk: notifikasi perubahan status pembayaran

**Blocked by:** None

**Status:** ready-for-agent

**What to build:** Pasal 3.10(1). Kotak masuk sudah ada, tetapi tidak ada notifikasi untuk pembayaran kedaluwarsa, gagal, atau dikembalikan (refund). Tambahkan notifikasi in-app untuk donatur berakun pada transisi tersebut (dari jalur webhook dan refund yang sudah ada, di dalam transaksi yang sama atau setelah commit sesuai pola src/lib/notifications.ts), dan daftarkan semua tipe notifikasi sistem yang ada ke peta ikon/label src/app/inbox/page.tsx.

- [ ] Test: webhook expired/failed membuat notifikasi untuk donatur berakun, tidak untuk tamu
- [ ] Test: refund selesai membuat notifikasi
- [ ] Test: tidak ada notifikasi ganda pada callback duplikat
