# 19: Modul zakat minimum di balik penanda fitur (default mati)

**Blocked by:** 18 (slot skema)

**Status:** ready-for-agent

**What to build:** Pasal 3.5 + 12(2), BERSYARAT, owner memutuskan dikerjakan (2026-11-09). Ini membatalkan sebagian ADR 0025: tulis ADR baru yang menggantikannya dengan alasan (kewajiban kontrak) dan menegaskan modul tetap MATI sampai YIEM memenuhi prasyarat legal Pasal 12(2) (dasar legal, prosedur, pencatatan, rekening, penyaluran). Bangun: penanda fitur zakat di setelan operasional tiket 01 (default mati, hanya Admin; saat mati semua route zakat 404 dan tidak muncul di menu/sitemap); halaman /zakat dengan zakat penghasilan dan zakat maal; kalkulator sederhana (nisab dari setelan Admin, tarif 2,5%); input nominal manual; checkout lewat jalur donasi yang sudah ada dengan tujuan zakat (Kind ZAKAT) dan penerima zakat yang dikonfigurasi Admin; bukti pembayaran elektronik (receipt yang ada, berlabel zakat); laporan transaksi zakat (CSV) dan pencatatan penyaluran zakat. Pemisahan pencatatan: ledger dan laporan memisahkan zakat dari donasi umum (tag entitas/kind dari tiket 04).

- [ ] Test: flag mati -> semua route zakat 404, tidak ada di sitemap
- [ ] Test kalkulator
- [ ] Test pemisahan zakat di laporan
- [ ] ADR baru menggantikan 0025
- [ ] Review independen sonnet (uang)
