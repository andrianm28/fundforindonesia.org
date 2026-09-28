# 05: Celah PRD mana yang masuk Rilis 1, dan dalam bentuk apa?

**Type:** grilling

**Status:** resolved

**Blocked by:** 01, 02, 03

## Question

Dari matriks 01–03: untuk setiap ❌/🟡 pada gerbang Fase 0–3 dan setiap ⚠️,
putuskan (a) tiket di peta ini, (b) tiket di peta `rilis-1-benda` karena
menyangkut alur uang, atau (c) ditunda dengan alasan. Untuk isi Fase 3 di luar
gerbang, putuskan per item masuk Rilis 1 atau tidak.

Setelah itu tulis putusan Rilis 1 (*siap kode* / *siap luncur*) dan serahkan
celah yang masuk ke `/to-spec`.

## Answer

Owner (Dri) menjawab "ya semua triase" 2026-09-28, satu pesan untuk seluruh
ronde -- rekomendasi di
[`triage-2026-09-28.md`](../triage-2026-09-28.md) Bagian A adalah keputusan,
Q1–Q18. Diresolve bersama tiket 06 karena keduanya dijawab dalam pesan yang
sama.

**Gerbang dan ⚠️ Fase 0–3:**

- **Q1** (Asset Waqf Inquiry, ❌): (a) tiket `prd-audit`, ditunda ke setelah
  gerbang Fase 2 -- lihat tiket 07.
- **Q2** (Guest Donor claim-by-email, ❌): (a) tiket `prd-audit`, dikerjakan
  sebelum Rilis 1 selesai, tidak memblokir Soft Launch -- lihat tiket 08.
- **Q3** (verifikasi kecil Fase 0/1, 🟡 bundel): (a) satu tiket verifikasi
  gabungan `prd-audit` -- lihat tiket 09.
- **Q4** (layar Payout, ❌, gerbang Fase 2): (b) `rilis-1-benda` lajur L1,
  prioritas tertinggi -- lihat `rilis-1-benda/issues/21`.
- **Q5** (Usage Report, ❌ nol kode, gerbang Fase 2): (b) `rilis-1-benda` lajur
  L1 -- lihat `rilis-1-benda/issues/22`.
- **Q6** (penyedia pembayaran kedua, ⚠️ + gerbang Fase 2): (a) Xendit sekarang,
  verifikasi fee+webhook settlement sebelum adapter -- diresolve di
  `rilis-1-benda/issues/18`.
- **Q7** (Refund siklus penuh, ❌, gerbang Fase 2 §7.2): (b) `rilis-1-benda`
  lajur L1, cakupan dipersempit ke create+approve dulu -- lihat
  `rilis-1-benda/issues/23`.
- **Q8** (Laporan Dormant Balance 60 hari, ❌, gerbang Fase 2 §7.3): (b)
  `rilis-1-benda` lajur L1 -- lihat `rilis-1-benda/issues/24`.
- **Q9** (backlog layar Admin: Suspension/Cancellation, Manual Contribution,
  abuse-thresholds, permukaan pengingat Kind Authorisation): (b)
  `rilis-1-benda` lajur L2, satu tiket per layar -- lihat
  `rilis-1-benda/issues/25`–`28`.
- **Q10** (layar Volunteer Trip, ❌, gerbang Fase 3): (b) `rilis-1-benda` lajur
  L3 -- lihat `rilis-1-benda/issues/29`.
- **Q11** (Sertifikat Volunteer Trip, ❌, gerbang Fase 3): (a) `prd-audit`
  dulu untuk memutuskan bentuk sertifikat -- lihat tiket 10.

**Isi Fase 3 di luar gerbang -- tidak masuk Rilis 1 (Q12–Q18):** lihat bagian
Out of scope di `map.md`.

Putusan Rilis 1 (*siap kode* / *siap luncur*) ada di `map.md` bagian
"Draf putusan Rilis 1", tidak diulang di sini.
