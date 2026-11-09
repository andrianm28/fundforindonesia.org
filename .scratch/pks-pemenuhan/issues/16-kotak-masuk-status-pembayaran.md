# 16: Kotak masuk: notifikasi perubahan status pembayaran

**Blocked by:** None

**Status:** done

**What to build:** Pasal 3.10(1). Kotak masuk sudah ada, tetapi tidak ada notifikasi untuk pembayaran kedaluwarsa, gagal, atau dikembalikan (refund). Tambahkan notifikasi in-app untuk donatur berakun pada transisi tersebut (dari jalur webhook dan refund yang sudah ada, di dalam transaksi yang sama atau setelah commit sesuai pola src/lib/notifications.ts), dan daftarkan semua tipe notifikasi sistem yang ada ke peta ikon/label src/app/inbox/page.tsx.

- [x] Test: webhook expired/failed membuat notifikasi untuk donatur berakun, tidak untuk tamu
- [x] Test: refund selesai membuat notifikasi
- [x] Test: tidak ada notifikasi ganda pada callback duplikat

## Comments

- Webhook: notifikasi `payment_expired`/`payment_failed` dibuat setelah commit transaksi, hanya bila delivery itu memang memindahkan Payment dari PENDING dan Donation benar-benar menjadi `failed` (tidak bila Payment saudara masih hidup). Callback duplikat tidak menghasilkan notifikasi. Tamu dan Trip Fee tidak dinotifikasi. Kegagalan membuat notifikasi hanya di-log; webhook tetap 200. Logika status/ledger tidak diubah.
- Refund: `completeRefund` membuat `refund_completed` setelah commit (klien yang sama), hanya untuk Donasi dengan `donorId`; kegagalan di-log, Refund tetap selesai.
- Registri `src/lib/notification-types.ts` memuat 15 tipe notifikasi sistem (label + nada ikon); inbox memakainya dengan fallback netral. `NotificationType` di `src/types/notification.ts` dilebarkan.
- Review: sub-agent tidak tersedia, ditinjau sendiri pada sumbu Standards dan Spec; tidak ada temuan terbuka. ESLint `session` tidak terpakai di inbox/page.tsx sudah ada sebelumnya.
