# 29: Layar Volunteer Trip -- catalog, Batch, Registration, dashboard, moderasi

**Type:** implementation

**Status:** open

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
