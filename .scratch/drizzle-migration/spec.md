# Migrasi Prisma ke Drizzle ORM

**Status:** ready-for-agent

Keputusan dan risikonya: [ADR 0029](../../docs/adr/0029-drizzle-replaces-prisma.md). Didahului upgrade Node 26 LTS (PR terpisah).

## Tujuan

Seluruh akses data aplikasi lewat Drizzle ORM, Prisma terhapus, tanpa satu pun perubahan skema produksi dan tanpa perubahan perilaku yang terlihat pengguna atau buku besar.

## Bukan tujuan

- Mengubah skema, nama tabel/kolom, atau tipe uang (rupiah tetap `Int`).
- Menulis ulang raw SQL, lock, atau batas transaksi "sekalian dirapikan".
- Upgrade Postgres (tetap 16).

## Aturan yang berlaku di setiap tiket

1. Prisma tetap pemilik migrasi sampai tiket 09. Tiket yang butuh perubahan skema dipecah: skema lewat Prisma dulu (PR skema sendiri), lalu kode.
2. Full suite dengan `TEST_DATABASE_URL` hijau sebelum PR dibuka; ratchet tidak naik.
3. Satu domain per PR; diff di atas ~300 baris dapat dua reviewer (Standards, Spec).
4. Kode uang, akses, atau lock: review independen `sonnet`, ringkasannya diposting di PR.
5. Tes penjaga statis (`src/__tests__/properties/*single-writer*`, `subject-lock-single-owner`, `campaign-writers`, `manual-contribution-isolation`, dll.) mencari pola Prisma. Saat call site pindah, penjaga itu diajari pola Drizzle yang setara di PR yang sama; penjaga tidak boleh lulus hanya karena tidak lagi menemukan apa pun.
6. Paritas dibuktikan oleh tes yang sudah ada; tes yang memock `prisma` diubah memock repository/`db`, bukan dihapus.

## Urutan tiket

| # | Tiket | Pemblokir |
| --- | --- | --- |
| 01 | Fondasi: paket, skema hasil introspeksi, klien `db`, mock build, cek paritas di CI | - |
| 02 | Repository field kontak (ADR 0012) dan adapter Auth.js | 01 |
| 03 | Baca publik: Campaign, kategori, pengaturan laman, sitemap, OG | 01 |
| 04 | Non-uang tulis: lembaga, tim, dokumen, verifikasi, notifikasi, short link | 02 |
| 05 | Admin dan moderasi non-uang, pengguna, audit log | 02 |
| 06 | Uang I: donasi, charge, webhook settlement, buku besar | 04, 05 |
| 07 | Uang II: escrow, refund, payout, transfer, zakat, rekonsiliasi, jobs | 06 |
| 08 | Seed, skrip, fixture e2e | 07 |
| 09 | Penutup: runner migrasi, hapus Prisma, Dockerfile, prompt deploy | 08 |
