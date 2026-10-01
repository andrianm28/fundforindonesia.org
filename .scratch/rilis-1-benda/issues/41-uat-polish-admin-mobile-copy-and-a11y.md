# 41: Poles hasil UAT: layar Admin di ponsel, konfirmasi ambang, bahasa, dan aksesibilitas

**Type:** implementation

**Status:** done

**Blocked by:** none

## Why

UAT putaran 1 (2026-09-29, Chromium terhadap `main` commit `64447c7`, 62 foto
layar) menemukan delapan cacat kecil sampai sedang; tak satu pun menghalangi
alur inti. Owner 2026-09-29 ("ya semua"): dikerjakan sebagai satu tiket poles. Butir 8 sampai 10 berasal dari UAT putaran 2 dan digabungkan di sini atas persetujuan owner 2026-10-01.
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

8. **Bukti transfer di layar Refund yang sudah selesai** (UAT putaran 2).
   `/admin/refunds/<id>` setelah Refund `COMPLETED` tidak menampilkan bukti
   transfer, padahal tersimpan di `Refund.proofImage` (dan layar Payout
   menampilkannya). Tampilkan referensi transaksi, catatan, dan bukti, dengan
   gaya yang sama seperti layar Payout.
9. **Angka mentah di penolakan saldo penyedia** (UAT putaran 2). Pesan
   penolakan persetujuan Payout mencetak "100000 ... 300000"; format sebagai
   rupiah (Rp 100.000) seperti angka lain di layar itu.
10. **Urutan penolakan dan peringatan awal** (UAT putaran 2). (a) Admin pencatat
    yang membalik Manual Contribution yang masih pending mendapat "tidak dapat
    dibalikkan oleh orang yang mencatat", padahal alasan yang lebih dasar adalah
    "belum disetujui": periksa status lebih dulu daripada pelaku, di lapisan
    yang menjawab, tanpa melonggarkan aturan mana pun. (b) Form permintaan Payout
    baru menampilkan blok Usage Report setelah submit; beri peringatan di awal
    bila Campaign itu punya Payout Completed tanpa Usage Report.

## Acceptance

- Tes untuk setiap perubahan yang punya perilaku: konfirmasi dan "diubah oleh" di
  layar ambang; hook tidak memanggil rute untuk pengunjung anonim; satu `main` dan
  satu `h1` di layout Admin.
- Tidak ada perubahan skema atau kode uang.
- Setelah selesai, jalankan ulang bagian UAT terkait (foto sebelum dan sesudah,
  di lebar 390px dan 1280px) dan lampirkan di laporan.

## Implementation note

Semua sepuluh butir dikerjakan; tes terarah hijau, ratchet di baseline (lint 193, tsc 47).

1. Done. Sidebar dipindah ke `src/components/admin/AdminSidebar.tsx` (client): tersembunyi di bawah `md` dengan tombol "Buka menu"/"Tutup menu" (`aria-expanded`), semua tautan dipertahankan. Tab mobile Moderasi bisa digulir mendatar dan tidak berdempetan.
2. Done. Pesan "Tersimpan" (`role=status`) dan baris "Terakhir diubah oleh ... pada ..." dari `setBy`/`setAt` (baris terbaru per jenis); tanpa baris: "Belum pernah diubah".
3. Done. Istilah developer dibuang dari teks layar (komentar kode tidak diubah).
4. Done. "benar-benar" dan "boleh menjalankan".
5. Done. `AppShell` tidak membungkus `/admin` dan `/moderasi` dengan `<main>` kedua; judul sidebar menjadi `<p>`, jadi satu `main` dan satu `h1` per halaman.
6. Done. `LazyImage` mendapat prop `fill` (HeroBanner memakainya, sebelumnya lebar inline 1200px mengalahkan `w-full`); footer memakai `new Date().getFullYear()`.
7. Done. `useTrafficSources(slug, creatorId)` hanya memanggil rute bila sesi adalah pembuat Campaign atau ber-assignment ADMIN. Rute tidak diubah.
8. Done. Layar Refund COMPLETED menampilkan "Bukti transfer" dari `Refund.proofImage` (referensi dan catatan, sudah tergabung oleh `buildProofImage`), gaya sama seperti layar Payout.
9. Done. Pesan penolakan di `src/lib/money/errors.ts` (`ProviderBalanceInsufficientError`, `ProviderBalanceNotShortError`) memakai `formatRupiah`; hanya teks pesan, tanpa logika uang.
10. Done. (a) `reverseManualContribution`: status dicek sebelum pelaku; semua orang tetap ditolak untuk yang belum APPROVED, dan pencatat/penyetuju tetap ditolak setelah APPROVED. (b) Panel Payout menampilkan peringatan sejak awal bila ada Payout selesai yang Usage Report-nya hilang atau dipertanyakan; tombol tidak diubah, server tetap penentu.

Belum dilakukan: foto sebelum/sesudah UAT di 390px dan 1280px (tidak ada browser di sesi ini); perlu dijalankan ulang oleh koordinator atau owner.
