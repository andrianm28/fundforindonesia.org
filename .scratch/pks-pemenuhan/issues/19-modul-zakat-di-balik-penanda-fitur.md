# 19: Modul zakat minimum di balik penanda fitur (default mati)

**Blocked by:** 18 (slot skema)

**Status:** done

**What to build:** Pasal 3.5 + 12(2), BERSYARAT, owner memutuskan dikerjakan (2026-11-09). Ini membatalkan sebagian ADR 0025: tulis ADR baru yang menggantikannya dengan alasan (kewajiban kontrak) dan menegaskan modul tetap MATI sampai YIEM memenuhi prasyarat legal Pasal 12(2) (dasar legal, prosedur, pencatatan, rekening, penyaluran). Bangun: penanda fitur zakat di setelan operasional tiket 01 (default mati, hanya Admin; saat mati semua route zakat 404 dan tidak muncul di menu/sitemap); halaman /zakat dengan zakat penghasilan dan zakat maal; kalkulator sederhana (nisab dari setelan Admin, tarif 2,5%); input nominal manual; checkout lewat jalur donasi yang sudah ada dengan tujuan zakat (Kind ZAKAT) dan penerima zakat yang dikonfigurasi Admin; bukti pembayaran elektronik (receipt yang ada, berlabel zakat); laporan transaksi zakat (CSV) dan pencatatan penyaluran zakat. Pemisahan pencatatan: ledger dan laporan memisahkan zakat dari donasi umum (tag entitas/kind dari tiket 04).

- [x] Test: flag mati -> semua route zakat 404, tidak ada di sitemap
- [x] Test kalkulator
- [x] Test pemisahan zakat di laporan
- [x] ADR baru menggantikan 0025
- [ ] Review independen sonnet (uang)

## Catatan

2026-11-09 (builder): ADR 0028 menggantikan 0025 (0025 ditandai digantikan). Penanda `zakat.enabled` + `nisabAmount` + `recipientOrganisationId` di setelan operasional (default mati; menyalakan ditolak tanpa izin ZAKAT dan Kind Authorisation lembaga penerima). Mati: `/zakat` 404 di `src/proxy.ts`, API Admin zakat 404, tidak di menu/footer/sitemap/daftar publik, checkout dan retry ber-Kind ZAKAT ditolak. Checkout lewat jalur donasi yang ada; receipt (halaman, PDF, email) berlabel zakat. Payout tidak bisa dipakai ulang untuk penyaluran (Payout = bayar lembaga dari saldo Campaign), jadi tabel baru `ZakatDistribution` (migrasi `20261111190000_modul_zakat_penyaluran`) hanya mencatat, tanpa entri buku besar, dengan batas total <= zakat diterima di bawah advisory lock. Rekap keuangan memisahkan zakat dari donasi umum; CSV transaksi zakat Admin-only aman formula injection; halaman `/admin/zakat`. Tinjauan sendiri (code-review) menemukan daftar publik (`listableCampaignWhere`) masih bisa memuat Campaign zakat saat modul mati; diperbaiki dengan tes. Review independen sonnet belum dilakukan (koordinator).

2026-11-09 (builder, perbaikan temuan review independen): (1) BLOCKER: donasi rutin melewati gerbang zakat. Penagihan (`billing.ts`) kini melewati dan mencatat log untuk Campaign ZAKAT yang akan ditolak `zakatCheckoutRefusal` (penanda mati atau penerima tidak cocok), dan `findRegistrableCampaign` mengembalikan null untuk Campaign semacam itu. Satu-satunya pembuat Donation adalah `POST /api/donations` dan penagihan rutin (keduanya digerbang); tidak ada jalur donasi offline yang menerima Kind ZAKAT. (2) `zakatPosition` memakai `countedPaymentWhere()` dan mengurangi Refund APPROVED/PROCESSING/COMPLETED dari Payment yang dihitung (Donation.paymentStatus tetap `confirmed` saat refund; Payment baru REFUNDED pada refund penuh), tidak pernah negatif. (3) Kalkulator: batas input `ZAKAT_INPUT_MAX` Rp10 triliun dengan pesan Indonesia; zakat maal baru ditampilkan wajib setelah kotak haul dicentang; tanpa klaim sertifikasi syariah. (4) `zakat-report.ts` menyaring dan mengurutkan menurut `paidAt` (tanggal yang ditampilkan). Semua dengan tes terlebih dulu. Review independen sonnet tetap tugas koordinator.
