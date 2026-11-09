# Modul zakat di balik penanda fitur, default mati

Menggantikan [ADR 0025](0025-zakat-out-of-scope.md) (zakat dikeluarkan dari cakupan produk), dengan alasan kewajiban kontrak: perjanjian kerja sama dengan YIEM (Pasal 12(2)) mengharuskan platform menyediakan jalur zakat. Keputusan owner 2026-10-16 tidak dibalik karena zakat tiba-tiba dianggap layak diluncurkan; yang berubah adalah bahwa kita terikat menyediakannya.

**Modul tetap MATI sampai YIEM memenuhi prasyarat hukum Pasal 12(2):** dasar hukum (lembaga amil zakat berizin atau yang setara), prosedur pengumpulan dan penyaluran, pencatatan, rekening khusus, dan penyaluran kepada mustahik. Menyalakan penanda tanpa itu berarti platform menampung zakat tanpa pihak yang berwenang menerimanya. Karena itu penanda dimatikan secara bawaan, hanya Admin yang bisa menyalakannya, dan menyalakannya ditolak bila lembaga penerima belum punya izin ZAKAT yang berlaku dan Kind Authorisation ZAKAT (ADR 0013).

## Keputusan

- **Penanda** `zakat.enabled` hidup di Pengaturan Operasional (SiteSetting `operations`, bertanda versi dengan riwayat), bersama `zakat.nisabAmount` dan `zakat.recipientOrganisationId`. Bawaan: mati. Gagal tertutup: nilai yang rusak dibaca sebagai mati.
- **Saat mati:** `/zakat` dan semua route zakat menjawab 404 (untuk `/zakat` dijawab di `src/proxy.ts`, karena `notFound()` di halaman tertahan di balik `loading.tsx` dan tetap berstatus 200); tidak ada di menu, footer, maupun sitemap; Campaign zakat tidak tampil di daftar publik; jalur donasi menolak checkout ber-Kind ZAKAT.
- **Tidak ada jalur uang baru.** Checkout zakat memakai jalur donasi yang sudah ada dengan Kind `ZAKAT`, ke Campaign zakat milik Partner Organisation yang ditetapkan Admin sebagai lembaga penerima (Collecting Entity, sudah terverifikasi). Merchant account `YAYASAN` (ADR 0027). Kuitansi elektronik adalah kuitansi yang sudah ada, berlabel zakat.
- **Kalkulator** `/zakat` (zakat penghasilan dan zakat maal): nisab dari pengaturan Admin, tarif 2,5%, plus input nominal manual. Kalkulator hanya membantu menghitung; bukan fatwa dan bukan klaim sertifikasi syariah.
- **Pemisahan zakat dari donasi umum:** buku besar sudah ditandai per Kind dan Collecting Entity; rekap keuangan menambah pemisahan zakat dari donasi umum, dan CSV transaksi zakat (khusus Admin, aman dari formula injection) dibaca dari baris yang sama.
- **Catatan penyaluran** memakai tabel baru `ZakatDistribution` yang hanya mencatat: tidak membuat entri buku besar dan tidak menyentuh Payout. Payout yang ada tidak bisa dipakai ulang, karena Payout adalah pembayaran dari saldo Campaign ke rekening terverifikasi (cara lembaga dibayar), sedangkan penyaluran adalah pernyataan tentang uang setelah keluar dari kita. Total yang dicatat tidak boleh melebihi zakat yang diterima lembaga (dicek di bawah advisory lock Postgres).

## Konsekuensi

- Nilai enum `ZAKAT` tidak lagi dibuang; langkah pembuangan di ADR 0025 dibatalkan.
- Category `zakat` yang dihapus migrasi `20261016063653_drop_zakat_category` tidak dikembalikan; Campaign zakat dikategorikan lewat Kind, bukan Category.
- Meluncurkan zakat ke publik tetap keputusan owner di luar kode: menyalakan penanda hanya setelah prasyarat di atas dibuktikan.
