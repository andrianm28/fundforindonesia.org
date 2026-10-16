# 96: Kategori yang tidak ada di /explore menjawab HTTP 200 (soft 404)

**Type:** bug

**Status:** needs-triage

**Blocked by:** none

Ditemukan saat memeriksa produksi setelah deploy `e56882e` (PR #251, #255) pada 2026-10-16.

## Gejala

`/explore/zakat` dan slug ngawur seperti `/explore/kategori-ngawur-xyz` menampilkan halaman "404 This page could not be found", dengan judul "Kategori Tidak Ditemukan". Kode HTTP-nya tetap **200**. Sebagai pembanding, `/zakat` menjawab 404 dengan benar. `/campaign/<slug-yang-tidak-ada>` juga menjawab 200, jadi polanya tidak terbatas pada `/explore`.

Pengunjung tetap melihat "tidak ditemukan", tetapi mesin pencari bisa mengindeks URL itu sebagai halaman sah. Ini termasuk URL `/explore/zakat` yang sudah terindeks sebelum zakat dicabut (ADR 0025).

## Dugaan penyebab

`src/app/explore/[category]/page.tsx` memanggil `notFound()` setelah query Prisma. Ada `src/app/loading.tsx` di root, jadi halaman dibungkus Suspense dan respons mulai di-stream dengan status 200 sebelum `notFound()` sempat dijalankan. `generateMetadata` di file yang sama juga tidak memanggil `notFound()`; ia mengembalikan judul "Kategori Tidak Ditemukan".

Belum diverifikasi. Langkah pertama: reproduksi dengan `curl -o /dev/null -w '%{http_code}'` terhadap build produksi lokal.

## Kriteria penerimaan

- Request `GET` ke `/explore/<slug-yang-tidak-ada>` menjawab HTTP 404.
- `/explore/<slug-yang-ada>` tetap 200 dan menampilkan daftar Campaign.
- Ada tes yang membuktikan status 404 untuk slug yang tidak ada, misalnya e2e Playwright yang memeriksa `response.status()`.
- Cek route dinamis lain yang memakai `notFound()` di bawah `loading.tsx` root (mis. `/campaign/[slug]`) untuk pola yang sama, dan catat temuannya di Comments.

## Comments
