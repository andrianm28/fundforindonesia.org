# 88: Layar Admin -- aturan Platform Fee dan riwayatnya

**Type:** implementation

**Status:** awaiting-merge

**Blocked by:** none

## Why

`POST /api/admin/platform-fee` (aturan per Kind, Category, Campaign, plus
ambang pembebasan) sudah ada dan teruji, tetapi tidak ada layar Admin di
belakangnya: mengubah Platform Fee hari ini hanya mungkin lewat `curl` atau
psql. Rencana Gelombang 0, item A-1 (`plan-missing-parts.md`): "layar aturan
Platform Fee + riwayat, di atas API yang sudah ada. Ukuran M."

Besaran fee belum diputuskan owner (C3). Rekomendasinya (5% untuk `donation`;
0 untuk bencana, zakat, wakaf, hibah; tanpa fee di bawah Rp50.000) masih
rekomendasi. Layar ini TIDAK boleh meng-hardcode angka itu; ia hanya
menampilkan dan mengubah aturan yang tersimpan, lewat API yang ada.

## Decision / scope

Halaman `/admin/platform-fee` (otorisasi sama dengan halaman Admin lain: layout
`/admin` mensyaratkan Assignment ADMIN):

- Aturan yang berlaku: tiap Kind (baris terbaru per Kind; belum ada baris
  ditampilkan sebagai belum diatur, yang oleh `resolvePlatformFeeBasis`
  berarti 0%), override per Category dan per Campaign (baris terbaru per
  kunci), dan ambang pembebasan terbaru.
- Riwayat: seluruh baris aturan dan ambang, terbaru dulu, dengan siapa dan
  kapan (`setBy`, `setAt`). Append-only, jadi riwayat adalah isi tabelnya.
- Form untuk menambah/mengubah satu aturan (scope KIND/CATEGORY/CAMPAIGN,
  persen) atau ambang (rupiah), memanggil `POST /api/admin/platform-fee`
  apa adanya. Validasi tetap milik server; form menampilkan penolakan server.
  Persen yang diketik diubah ke basis point (`percentBps`) hanya sebagai
  format.
- Tautan di `AdminSidebar`.

Di luar lingkup: mengubah semantik API atau logika uang, skema, angka default
apa pun, tampilan fee di checkout (tiket P2). Bila API kurang sesuatu yang
esensial, dilaporkan, tidak ditambal di sini.

## Acceptance

- [x] Halaman menampilkan aturan berlaku per Kind, override Category dan
      Campaign, dan ambang, dari baris terbaru di database.
- [x] Kind tanpa baris ditampilkan sebagai belum diatur, bukan angka karangan.
- [x] Riwayat menampilkan semua baris dengan siapa dan kapan, terbaru dulu.
- [x] Form memposting body yang tepat ke API yang ada (rule per scope,
      threshold) dan menampilkan penolakan server apa adanya.
- [x] Tidak ada angka fee, persen, atau ambang di-hardcode di halaman/form.
- [x] Tautan sidebar ke `/admin/platform-fee`.

## Comments

- 2026-10-04, branch `claude/rilis-1-88-admin-platform-fee-page`: dibangun
  test-first. Halaman `/admin/platform-fee` (server component, `force-dynamic`)
  membaca `platformFeeRule` dan `platformFeeThreshold` langsung dan menurunkan
  "yang berlaku" dari baris terbaru per Kind/Category/Campaign, aturan yang
  sama dengan `resolvePlatformFeeBasis`. Kind tanpa baris tampil "Belum
  diatur". `AdminPlatformFeeForm` memposting ke API yang ada tanpa mengubahnya;
  persen diketik lalu diubah ke basis point lewat aritmetika string, validasi
  tetap di server. Tidak ada angka fee di-hardcode. Sidebar: satu tautan, plus
  href-nya di `ADMIN_HREFS` agar status aktif jalan (dan daftar tes sidebar).
- Batasan yang dilaporkan, bukan ditambal: override Campaign memakai ID
  Campaign yang diketik (API hanya menerima `campaignId`); tidak ada pemilih
  Campaign. API tidak punya GET, jadi halaman membaca lewat Prisma seperti
  halaman Admin lain.
