# 11: Donatur dan penggalang: unduh bukti, kampanye didukung, ringkasan nominal

**Blocked by:** None

**Status:** done

**What to build:** Pasal 3.8–3.9. (a) Tombol 'Unduh bukti (PDF)' di /donasi-saya dan halaman receipt yang menghasilkan berkas PDF (tanpa dependensi berbayar; boleh render server sederhana). (b) Bagian 'Kampanye yang Anda dukung' (unik per Campaign, total donasi PAID). (c) Dasbor penggalang: ringkasan total nominal donasi masuk (PAID) per Campaign dan total semua.

- [x] Test PDF hanya untuk pemilik/token sah
- [x] Test agregasi hanya PAID

## Comments

- Builder (2026-11-09): PDF ditulis tangan (`src/lib/receipt-pdf.ts`, satu halaman, Helvetica, tanpa dependensi) dan disajikan oleh `GET /api/receipts/[token]/pdf`. Gerbangnya sama persis dengan halaman receipt: token saja (Guest Donor tidak punya sesi), 404 untuk token tak dikenal, `Content-Disposition: attachment`, `Cache-Control: private, no-store`; Donor yang sudah dianonimkan tercetak "Donor anonim". Tombol ada di /donasi-saya dan ReceiptView.
- Agregasi di `src/lib/donation-summaries.ts`: hanya Donation `paymentStatus: 'confirmed'` (PAID). Ringkasan penggalang juga mengecualikan Donation yang Payment-nya sandbox (uang uji, selaras counted-payment); tampilan Donor atas donasinya sendiri tidak memakai pengecualian itu. `/api/donations/mine` menambah `supportedCampaigns`; `/api/user/campaigns` menambah `income` (semua Campaign milik penggalang, bukan hanya halaman itu).
- Tes: receipt-pdf, route pdf, donation-summaries, mine, user/campaigns, donasi-saya, ReceiptView, kampanye-saya. Tidak ada perubahan skema. Review mandiri dua sumbu (Standards, Spec) tanpa temuan terbuka.
