# 97: Panel Partner Organisation tidak bisa mengoreksi nomor izin dan penerbit Fundraising Permit

**Type:** task

**Status:** done

**Blocked by:** none

Ditemukan saat mendaftarkan YIEM di produksi pada 2026-10-16. Atas arahan owner, YIEM didaftarkan dengan Fundraising Permit dummy (`DUMMY-UAT-BELUM-ASLI`, berlaku sampai 31 Des 2026, Kind Donasi) supaya UAT Blok 3 bisa jalan. Owner berencana mengganti data itu dengan data asli lewat panel.

## Masalah

Backend sudah mendukung koreksi. `PATCH /api/moderasi/partner-organisations/[id]/permits/[permitId]` menerima `number`, `issuer`, `kinds`, `validFrom`, dan `validTo` lewat `updateFundraisingPermit` di `src/lib/partner-organisations.ts`.

Panel `/moderasi/partner-organisations` (`src/app/moderasi/partner-organisations/PartnerOrganisationRegister.tsx`) hanya menampilkan kolom "Perpanjang sampai", yang mengubah `validTo` saja. Verifier tidak bisa membetulkan nomor izin, penerbit, Kind, atau tanggal mulai tanpa memanggil API langsung atau mencatat izin baru. Kalau izin baru dicatat, izin yang salah tetap tampil sampai kedaluwarsa.

## Kriteria penerimaan

- Di kartu tiap Fundraising Permit ada aksi "Koreksi" yang bisa mengubah nomor izin, penerbit, Kind yang dicakup, berlaku dari, dan berlaku sampai, lewat route `PATCH` yang sudah ada.
- Galat validasi dari `updateFundraisingPermit` tampil di kartu itu, dengan teks yang sama seperti pada formulir "Catat Fundraising Permit".
- Setiap koreksi tercatat di audit Partner Organisation, seperti yang sudah dilakukan backend sekarang. Tiket ini tidak mengubah backend.
- Tes komponen membuktikan koreksi mengirim hanya field yang berubah, dan label "(berlaku)" / "(tidak berlaku)" mengikuti tanggal baru setelah disimpan.

## Setelah selesai

Ganti izin dummy YIEM dengan data dari dokumen asli lewat aksi ini.

## Comments
- 2026-10-30: aksi "Koreksi" di kartu Fundraising Permit (PermitRow) memakai PATCH yang sudah ada, hanya mengirim field yang berubah; tes komponen ditambahkan. Menunggu merge; setelah itu owner mengganti izin dummy YIEM lewat panel.
- 2026-10-30: merged ke main lewat #293 (squash 422334f), atas persetujuan owner. Belum ter-deploy.
