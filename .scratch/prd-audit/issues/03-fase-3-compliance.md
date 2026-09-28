# 03: Seberapa patuh `main` terhadap PRD untuk Fase 3, dan apa yang bertentangan?

**Type:** research

**Status:** resolved

**Findings:** `.scratch/prd-audit/research/03-fase-3.md`

**Blocked by:** —

## Question

1. Gerbang Fase 3: Volunteer Trip end to end sampai sertifikat terbit, satu
   Batch dengan Trip Fee nyata, dan satu Refund Trip Fee. Apa yang ada, apa yang
   bisa dijangkau, dan apa yang hilang?
2. Isi Fase 3 di luar gerbang (versi Inggris, WhatsApp, tautan pendek, impor
   settlement otomatis, pengalihan Dormant Balance, Refund yang diminta Donor,
   anggota tim Fundraiser organisasi): status masing-masing dan perkiraan kasar
   ukurannya (S/M/L), sebagai bahan tiket 05.
3. §12–§14: risiko, pertanyaan terbuka, dan catatan deck. Mana yang sudah
   dijawab kode atau ADR, mana yang masih terbuka?
4. Sapuan ⚠️ di seluruh PRD: kode yang melakukan sesuatu yang dilarang PRD atau
   ADR, termasuk jalur uang yang bisa menerima uang tanpa sakelar.

Keluaran ke `.scratch/prd-audit/research/03-fase-3.md` di branch
`research/prd-audit-03`.

## Answer

Gerbang Fase 3 **🟡**: jalur uang Trip Fee (Registration, Batch, Refund Trip
Fee, Trip Payout) sudah terpasang ujung-ke-ujung di lapisan API dengan
kode+tes, tapi gerbangnya gagal pada dua hal independen — tidak ada satu
layar pun yang menjangkau alur ini (Trip catalog, Batch picker, Registration,
dashboard Volunteer semuanya tidak ada), dan sertifikat nol kode sama sekali
(❌ murni). Item Fase 3 di luar gerbang (i18n, WhatsApp, tautan pendek, impor
settlement otomatis, pengalihan Dormant Balance, Refund oleh Donor, anggota
tim organisasi) semuanya belum dimulai (❌), ukuran S sampai M/L, jadi bahan
keputusan per item di tiket ini masuk ke tiket 05. ⚠️ paling serius: rute
Registration Trip Fee tidak punya sakelar `donationsEnabled()` maupun
`sandboxInProductionReason()` seperti rute Donation — kill switch donasi
global tidak menutup Trip Fee, dan interlock sandbox-di-produksi juga tidak
berlaku di sana.

Pointer: `.scratch/prd-audit/research/03-fase-3.md`.
