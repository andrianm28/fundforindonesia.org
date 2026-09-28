# 01: Seberapa patuh `main` terhadap PRD untuk gerbang Fase 0 dan Fase 1?

**Type:** research

**Status:** resolved

**Findings:** `.scratch/prd-audit/research/01-fase-0-1.md`

**Blocked by:** —

## Question

Untuk setiap requirement PRD yang masuk cakupan Fase 0 dan Fase 1 (§11), ditambah
§1–§6 dan §7.1: apa statusnya di `origin/main` (✅ / 🟡 / ❌ / ⚠️) menurut standar
bukti di `map.md`, dengan `file:line`?

Keluaran: tabel per requirement, ringkasan per bab, dan daftar ⚠️ di bagian
atas. Tulis ke `.scratch/prd-audit/research/01-fase-0-1.md` di branch
`research/prd-audit-01`, lalu beri pointer di tiket ini.

## Answer

Gerbang Fase 0 **siap kode**: seluruh elemen (`CampaignStatus`,
`VerificationRequest` dengan checklist, `IdentityVerification`,
Verifier/Admin terpisah, AutoDonation diparkir) ada di kode dengan test.
Gerbang Fase 1 **🟡 siap kode**: adapter Sumopod, Platform Fee, Zakat/Wakaf/
Hibah inti, dashboard, Impact, Demo Campaign, dan CSR/Partnership Inquiry
sudah ✅ kode+tes, tapi dua celah nyata bikin statusnya bukan ✅ penuh: (1)
**Asset Waqf Inquiry** tidak ada kodenya sama sekali, dan (2) **Guest Donor
claim-by-email dengan verifikasi tautan** (FFI-13) tidak ditemukan alurnya.
Kedua fase **siap luncur** untuk Fase 0 (tidak menerima uang, sakelar donasi
default mati); Fase 1 belum bisa dinilai siap luncur sampai dua celah kode
di atas diputuskan dan `SUMOPOD_BASE_URL` produksi dikonfirmasi.

⚠️ tambahan dicatat di riset: dwibahasa belum disiapkan sejak Fase 1 (bukan
gerbang), dan `CONTEXT.md` sempat basi pada entri Bank Account (sudah
dikoreksi merujuk kode, bukan dokumen).

Pointer: `.scratch/prd-audit/research/01-fase-0-1.md`.
