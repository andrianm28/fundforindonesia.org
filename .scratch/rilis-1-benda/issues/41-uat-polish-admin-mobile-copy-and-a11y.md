# 41: Poles hasil UAT: layar Admin di ponsel, konfirmasi ambang, bahasa, dan aksesibilitas

**Type:** implementation

**Status:** ready-for-agent

**Blocked by:** none

## Why

UAT putaran 1 (2026-09-29, Chromium terhadap `main` commit `64447c7`, 62 foto
layar) menemukan delapan cacat kecil sampai sedang; tak satu pun menghalangi
alur inti. Owner 2026-09-29 ("ya semua"): dikerjakan sebagai satu tiket poles.
Bukan gerbang Fase mana pun, tetapi layar Admin adalah yang dipakai operator
sehari-hari.

## Scope

1. **Layout Admin di ponsel (390px).** Sidebar 256px selalu tampil, sehingga isi
   terjepit dan halaman bergulir ke samping (`scrollWidth` 1009 lawan 390).
   Buat sidebar tersembunyi atau dilipat di bawah lebar tablet, dengan tombol
   untuk membukanya, sejalan dengan bar mobile yang sudah dipakai layout Moderasi.
   Tab atas Moderasi di ponsel juga berdempetan ("DashboardKampanye"): beri jarak
   atau gulir mendatar.
2. **`/admin/abuse-thresholds`.** Setelah Simpan tidak ada konfirmasi: tombol hanya
   menjadi abu-abu. Tampilkan pesan berhasil, dan tampilkan siapa yang terakhir
   mengubah setiap ambang dan kapan (`setBy`, `setAt`; datanya sudah ada di
   `resolveAbuseThresholds` atau barisnya, periksa dulu).
3. **Istilah developer di tampilan Admin.** Buang dari teks yang dilihat
   operator: "CONTEXT.md", "FFI-07", "ticket 30", "Q7(c)", "Rilis 1",
   "AwaitingDonorDetails", "PRD §", "ADR 0015". Ganti dengan bahasa Indonesia
   yang menjelaskan akibatnya bagi operator; rujukan teknis tetap di komentar kode,
   bukan di layar. Cari dengan `rg` pada `src/app/admin` dan `src/components/admin`.
4. **Salah tulis.** "benar benar" menjadi "benar-benar"; "boleh jalankan" menjadi
   "boleh menjalankan".
5. **Struktur HTML halaman `/admin/*`.** `<main>` bersarang di dalam `<main>` dan
   ada dua `h1` (judul sidebar "Admin Panel" adalah `h1`). Satu `<main>` per
   halaman, satu `h1` per halaman.
6. **Beranda.** Hero selebar sekitar 1200px meninggalkan strip abu-abu di kanan
   pada lebar 1280px; footer masih tertulis "© 2024" (pakai tahun berjalan, dari
   kode, bukan angka tetap).
7. **Kebisingan konsol pada halaman Campaign.** Pengunjung anonim memicu
   `GET /api/campaigns/<slug>/traffic-sources` yang menjawab 403, tampil sebagai
   error konsol. Rute itu memang khusus pemilik atau Admin (sengaja, lihat
   komentarnya), jadi perbaikannya di sisi klien: `src/lib/hooks/useTrafficSources.ts`
   hanya memanggil rute itu bila pemakai adalah pemilik Campaign atau Admin. Jangan
   melonggarkan rutenya.

## Acceptance

- Tes untuk setiap perubahan yang punya perilaku: konfirmasi dan "diubah oleh" di
  layar ambang; hook tidak memanggil rute untuk pengunjung anonim; satu `main` dan
  satu `h1` di layout Admin.
- Tidak ada perubahan skema atau kode uang.
- Setelah selesai, jalankan ulang bagian UAT terkait (foto sebelum dan sesudah,
  di lebar 390px dan 1280px) dan lampirkan di laporan.
