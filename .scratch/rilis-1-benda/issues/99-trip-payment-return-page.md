# 99: Halaman hasil pembayaran untuk pendaftar Volunteer Trip

**Type:** task

**Status:** needs-triage

**Blocked by:** 98

Dipisah dari tiket 98, yang hanya menangani Donation.

## Masalah

`src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts` memanggil `provider.createCharge` tanpa `successReturnUrl` atau `cancelReturnUrl`, sehingga Sumopod memakai URL default dashboard yang sama untuk semua pembayaran. Pendaftar Volunteer Trip yang selesai membayar tidak mendapat halaman yang menunjukkan status pembayaran pendaftarannya.

Halaman tiket 98 (`/donasi/hasil/<token>`) berpusat pada Donation, sedangkan pembayaran Volunteer Trip melekat pada Registration (`Payment.registrationId`), jadi halaman dan tokennya berbeda.

## Kriteria penerimaan

- Ada halaman hasil pembayaran per Registration, dibuka dengan token bertanda tangan seperti tiket 98 (domain HMAC sendiri, tanpa kolom baru), yang menampilkan status Payment apa adanya.
- Rute pendaftaran mengirim `successReturnUrl` dan `cancelReturnUrl` per pembayaran ke halaman itu.
