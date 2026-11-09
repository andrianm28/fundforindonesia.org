# 10: Publik: pengurutan katalog, donatur teratas, moderasi doa

**Blocked by:** 09 (slot skema)

**Status:** done

**What to build:** Pasal 3.7. (a) Parameter `sort` di /api/campaigns dan UI katalog: terbaru, hampir tercapai, paling banyak terkumpul, segera berakhir. (b) Tab 'Donatur teratas' di halaman Campaign (nominal terbesar, anonim tanpa nama, hanya donasi PAID). (c) Moderasi doa: kolom hidden + hapus lunak di Prayer, layar Admin/Verifier untuk sembunyikan/tampilkan/hapus, tercatat siapa dan kapan; doa tersembunyi tidak muncul di publik dan beranda.

- [x] Test setiap urutan
- [x] Test donatur teratas menghormati anonim
- [x] Test doa tersembunyi tidak muncul

## Comments

- Pengurutan: `?sort=` di `/api/campaigns` (`terbaru` default, `hampir-tercapai`, `terbanyak`, `segera-berakhir`; nilai lain 400). `terbaru` dan `segera-berakhir` diurutkan database (`createdAt desc`; `deadline asc nulls last` lewat indeks `(lifecycleStatus, deadline)` yang sudah ada, wakaf tanpa tenggat di akhir). Dua urutan berbasis uang diurutkan di aplikasi atas angka TERHITUNG (`withCountedCollectedAmount`, bukan penghitung tersimpan yang masih memuat uang sandbox), lalu halaman dibaca per id. `hampir-tercapai` menaruh yang sudah mencapai target setelah yang belum. Pemilih "Urutkan" ada di `/explore/all`; halaman kategori belum diberi pemilih.
- Donatur teratas: tab di halaman Campaign (hanya untuk Campaign yang publik), `GET /api/campaigns/[slug]/top-donors`, 10 teratas, hanya Donation `confirmed` dengan Payment `PAID` dan terhitung (`countedPaymentWhere`; REFUNDED dan sandbox tidak masuk). Donor anonim (termasuk yang dianonimkan belakangan, ADR 0023) tampil "Anonim"; entri hanya memuat peringkat, nama, dan nominal, tanpa id Donation, tanggal, pesan, avatar, atau kontak, dan kueri tidak memilihnya.
- Moderasi doa: migrasi `20261111100000_moderasi_doa` menambah `Prayer.hidden/hiddenAt/hiddenById/deletedAt/deletedById` (id sebagai teks tanpa FK agar catatan siapa bertahan setelah akun dihapus; tanpa indeks baru, `campaignId` dan `createdAt` yang ada sudah cukup). Satu aturan publik: `publicPrayerWhere`/`isPublicPrayer` di `src/lib/prayer-moderation.ts`, dipakai `/api/prayers`, beranda, dan Aamiin (doa tersembunyi atau terhapus menjawab 404). `PATCH /api/moderasi/prayers/[id]` (`hide`/`show`/`delete`, penjaga `updateMany` agar moderator pertama tidak tertimpa, doa terhapus final: 409) dan `GET /api/moderasi/prayers`, lewat `withHiddenAnyAssignmentCheck`: Verifier ATAU Admin, siapa pun lain 404 (401 bila belum masuk). Layar `/moderasi/doa` (layout Verifier) dan `/admin/doa` (layout Admin) berbagi `PrayerModerationScreen`. Daftar moderator tidak memuat Donor.
- Allowlist: `roles-expand-guard` (satu berkas non-route baru dengan alasan, plus pin 404), properti baru `prayer-public-readers` (setiap pembaca tabel Prayer terdaftar dengan alasan).
- Catatan untuk owner: (1) tiket ini bergantung "slot skema" tiket 09 yang belum dikerjakan; migrasi memakai cap waktu sendiri sehingga tidak bertabrakan. (2) Donatur anonim tetap tampil dengan nominalnya sebagai "Anonim", sama seperti daftar donasi publik yang ada; bila nominal anonim pun harus disembunyikan, ubah `topDonorsForCampaign`. (3) `/api/prayers` ber-cache publik 60 detik, jadi doa yang disembunyikan bisa masih terlihat sampai satu menit.
- Verifikasi: migrasi diterapkan, `prisma migrate diff` kosong, tsc tetap 19.
