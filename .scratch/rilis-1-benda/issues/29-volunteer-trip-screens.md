# 29: Layar Volunteer Trip -- catalog, Batch, Registration, dashboard, moderasi

**Type:** implementation

**Status:** resolved

**Blocked by:** 10 (`prd-audit`, bentuk sertifikat -- untuk sertifikatnya
saja; layar catalog/Batch/Registration/dashboard/moderasi tidak menunggunya)

## Why

Tidak ada Trip catalog, Trip detail, Batch picker, Registration flow,
dashboard Volunteer, atau layar moderasi Verifier -- semua rute API ada
tapi tak satu pun dipanggil UI manapun. `VolunteerTripStatus.SUSPENDED` ada
di enum tapi tak pernah ditulis. Gerbang Fase 3 eksplisit menyebut
"Volunteer Trip end to end". Owner 2026-09-28
(`prd-audit/triage-2026-09-28.md` Bagian A, Q10): `rilis-1-benda`, lajur L3.

## Decision / scope

Layar utama (catalog, detail, Batch picker, Registration flow, dashboard
Volunteer, moderasi Verifier) plus dua tiket kecil terpisah dalam lajur yang
sama, tidak memblokir layar utama: Trip suspension
(`VolunteerTripStatus.SUSPENDED` ditulis) dan identity-verification saat
pengajuan Trip pertama (`decideTripSubmission` membuat Identity
Verification seperti jalur Campaign). Sertifikat menunggu bentuknya
diputuskan di `prd-audit/issues/10`.

Q6 (owner 2026-09-28, "ya semua" ke ticket 31): membuat Trip Fee Refund dari
sebuah layar (bukan lewat API langsung) adalah bagian tiket ini, digerbangi
Fase 3 seperti layar lain di atas -- `completeRefund` (ticket 31) sendiri
tidak menunggu tiket ini, karena `/admin/refunds` sudah menjangkau subjek
Trip lewat rute Trip-nya.

## Answer

Owner (Dri), 2026-09-29, grilling putaran 1 dan 2 ("ya semua"): tiket ini dipecah
per layar, dan bentuk sertifikatnya diputuskan
(`prd-audit/issues/10`). Pemecahannya:

- 33: katalog publik, detail Trip, pemilih Batch.
- 34: moderasi Verifier untuk pengajuan Trip.
- 35: layar Fundraiser (buat, ajukan, Batch, batalkan, selesaikan; kolom `attended`).
- 36: Registration dan pembayaran Trip Fee, digerbangi
  `NEXT_PUBLIC_VOLUNTEER_ENABLED`.
- 37: dashboard Volunteer dan sertifikat.
- 38: Trip suspension oleh Admin.
- 39: verifikasi identitas pada pengajuan Trip pertama.
- 40: Trip Fee yang settle setelah penahanan kedaluwarsa dikembalikan otomatis.

Urutan bangun: 33 dan 34 paralel, lalu 35, lalu 36, lalu 37. Tiket 38, 39, dan 40
bisa dikerjakan kapan saja. Pembuatan Trip Fee Refund dari layar (Q6 ticket 31)
tetap bagian tiket ini: layar Admin `/admin/refunds` sudah menjangkau subjek Trip,
dan layar Volunteer membatalkan lewat tiket 36 dan 37.
