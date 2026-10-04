# 48: Jalur Admin/support untuk anonimisasi Donation yang HMAC-nya memakai key id lama atau tanpa email

**Status:** ready-for-agent

**Blocked by:** none

Anonimisasi Guest (tiket 36) mencocokkan email yang diketik Donor dengan `guestEmailHmac` di bawah key id yang sedang aktif, sehingga Donor yang Donation-nya disegel dengan key id HMAC lama (setelah rotasi kunci, ADR 0020) atau tanpa email sama sekali tidak bisa menganonimkan identitasnya sendiri lewat tautan Receipt, dan tidak ada jalur lain selain intervensi manual di database. Perlu jalur terbatas bagi Admin/support untuk menganonimkan Donation seperti itu atas permintaan Donor yang terverifikasi, memakai modul anonimisasi yang sama agar yang dihapus dan yang disimpan tetap identik.

- [ ] Hanya peran Admin yang bisa memicu, dengan sesi; pemanggil tanpa peran itu mendapat 403 dan tidak ada yang berubah
- [ ] Mencakup Donation dengan key id HMAC lama dan Donation tanpa email, dengan aturan yang sama dengan jalur Donor (Refund terbuka memblokir; Donation ber-akun tidak disentuh)
- [ ] Setiap pemakaian meninggalkan catatan audit (siapa, kapan, Donation mana) tanpa data pribadi
- [ ] Tes di seam route dan satu tes Postgres sungguhan untuk kedua kasus

## Comments

- 2026-10-04 (percepatan-full-rilis, Track D): hitungan baca-saja di produksi menunjukkan key id yang ada hanya `enc-k1` dan `hmac-k1`, jadi belum ada Donation yang HMAC-nya memakai key id lama. Jalur ini baru dibutuhkan setelah rotasi kunci pertama (ADR 0020) atau bila ada Donation tanpa email, sehingga **dikerjakan pasca-rilis**, bukan pemblokir Rilis 1. Status berubah dari `needs-triage` ke `ready-for-agent` karena isinya sudah spesifik; dispatch menunggu setelah rilis. Bila hitungan itu kelak menemukan baris key lama sebelum rilis, tiket ini naik jadi pra-rilis.
