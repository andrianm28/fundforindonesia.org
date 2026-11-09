# Runbook: insiden (saklar donasi dan mode pemeliharaan)

Dipakai Admin saat ada kejadian yang menuntut uang berhenti masuk atau situs berhenti menerima tulisan: provider bermasalah, ledger tidak cocok, kebocoran kredensial, atau pemeliharaan terencana. Layarnya **Admin Panel > Operasional** (`/admin/operasional`). Perubahan berlaku saat itu juga, tanpa build ulang. Asal: `.scratch/pks-pemenuhan/issues/01-saklar-donasi-dan-mode-pemeliharaan.md`.

## Dua pengaman, dan hubungannya

| Pengaman | Diubah lewat | Sifat |
| --- | --- | --- |
| `NEXT_PUBLIC_DONATIONS_ENABLED` | variabel lingkungan, butuh build ulang | Gerbang keras. Selain `true` persis, donasi tertutup. |
| Saklar donasi | panel Operasional | Kunci kedua. Hanya bisa **menutup**. |

Donasi berjalan hanya bila env `true` **dan** saklar hidup. Panel tidak bisa membuka donasi yang ditutup env; bila env bukan `true`, halaman Operasional menulis peringatannya.

Mengosongkan `PAYMENT_PROVIDER` **bukan** kill switch: pilihan provider Admin di panel Payment Provider mengalahkannya.

## Menutup donasi (uang berhenti masuk)

1. Buka **Operasional**, matikan **Terima donasi**, klik **Simpan**.
2. Yang berhenti dengan jawaban 503 dan pesan "Donasi sedang tidak tersedia ...": `POST /api/donations`, `POST /api/donations/[id]/retry`, dan pendaftaran Volunteer Trip berbayar. Halaman donasi langsung menampilkan pesan donasi ditutup.
3. Yang **tetap jalan**: webhook provider. Pembayaran yang sudah berjalan harus tetap tercatat; mematikannya membuat uang ada di provider tanpa catatan.
4. Setelah masalah selesai, jalankan `GET /api/admin/reconcile` (atau halaman **Rekonsiliasi**) dan pastikan seimbang sebelum menyalakan lagi.

## Mode pemeliharaan (situs berhenti menerima tulisan)

1. Buka **Operasional**, nyalakan **Mode pemeliharaan**, isi pesan bila perlu (maks. 500 karakter; kosong memakai pesan bawaan), klik **Simpan**.
2. Efeknya:
   - Semua halaman publik menampilkan banner dengan pesan itu.
   - Semua `POST`, `PUT`, `PATCH`, dan `DELETE` ke `/api/*` dari selain Admin dijawab 503 dengan pesan itu dan header `Retry-After`. Membaca (`GET`) tidak ditolak.
3. Yang **tetap jalan**: `/admin` dan `/api/admin` (jalan untuk mematikan mode ini), webhook, `/api/health` (dipoll skrip deploy), login/logout, pekerjaan terjadwal (`/api/internal`), dan laporan error browser. Admin yang sedang masuk tetap bisa menulis.
4. Bila pembacaan setelan gagal (database tak terjangkau), mode ini tidak menolak apa pun: gagal terbuka, supaya setelan yang tak terbaca tidak mematikan API. Saklar donasi sebaliknya gagal **tertutup**.

## Jejak perubahan

Setiap perubahan (siapa, kapan, nilai lama dan baru) tercatat dan tampil di **Riwayat perubahan** pada halaman yang sama; 50 terakhir disimpan. Datanya satu baris `SiteSetting` berkunci `operations`, terpisah dari Pengaturan Laman Publik.

## Bila panel tidak terjangkau

Admin tidak bisa masuk panel (mis. login rusak): owner menutup donasi dengan mengubah `NEXT_PUBLIC_DONATIONS_ENABLED` dan membangun ulang image, di host produksi, mengikuti alur deploy biasa.
