# Zakat dikeluarkan dari cakupan produk

**Digantikan oleh [ADR 0028](0028-zakat-module-behind-feature-flag.md)** (2026-11-09): kewajiban kontrak Pasal 12(2) mengharuskan modul zakat tersedia, di balik penanda fitur yang default mati. Catatan di bawah dibiarkan sebagai riwayat.

Diputuskan owner pada 2026-10-16 ("takeout semua zakat"). Zakat tidak lagi bagian dari Fund for Indonesia: tidak ada halaman `/zakat`, kalkulator, menu, CTA beranda, entri sitemap, Category, maupun Campaign sampel. Kind `zakat` tidak bisa dipilih, dibuat, atau diberi Kind Authorisation, dan tidak muncul di layar Admin (Platform Fee, checklist, daftar Partner Organisation).

**Yang sengaja tidak dilakukan:** nilai `ZAKAT` tetap ada di enum `Kind` Prisma dan di tabel yang menyusunnya (aturan refund, Campaign Transfer). Menghapusnya butuh migrasi destruktif yang sulit dibatalkan (rollback produksi harus restore database) dan hanya aman setelah dipastikan tidak ada baris produksi ber-Kind `zakat`. Sampai itu, nilainya hanya mencegah baris lama gagal dibaca.

**Tindak lanjut terpisah (butuh persetujuan owner):** cek produksi untuk baris `Campaign.kind = ZAKAT`, `KindAuthorisation.kind = ZAKAT`, `Category.slug = 'zakat'`, aturan Platform Fee dan item checklist ber-Kind `zakat`; bila kosong, migrasi yang membuang nilai enum dan Category itu.

**Hasil cek produksi (2026-10-16, baca-saja):** nol baris ber-Kind `ZAKAT` di Campaign, Kind Authorisation, Platform Fee, dan Campaign Transfer; dua item checklist ber-Kind `ZAKAT` (tidak terpakai); satu Category `zakat` dan dua Campaign sampel seed berkategori `zakat` dengan Kind `DONATION`. Category dihapus lewat migrasi data `20261016063653_drop_zakat_category`; kedua Campaign sampel di-Suspend Admin lewat layar Admin. Pembuangan nilai enum `ZAKAT` tetap langkah terpisah.
