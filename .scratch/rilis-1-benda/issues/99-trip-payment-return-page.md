# 99: Halaman hasil pembayaran untuk pendaftar Volunteer Trip

**Type:** task

**Status:** done

**Blocked by:** 98

Dipisah dari tiket 98, yang hanya menangani Donation.

## Masalah

`src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts` memanggil `provider.createCharge` tanpa `successReturnUrl` atau `cancelReturnUrl`, sehingga Sumopod memakai URL default dashboard yang sama untuk semua pembayaran. Pendaftar Volunteer Trip yang selesai membayar tidak mendapat halaman yang menunjukkan status pembayaran pendaftarannya.

Halaman tiket 98 (`/donasi/hasil/<token>`) berpusat pada Donation, sedangkan pembayaran Volunteer Trip melekat pada Registration (`Payment.registrationId`), jadi halaman dan tokennya berbeda.

## Kriteria penerimaan

- Ada halaman hasil pembayaran per Registration, dibuka dengan token bertanda tangan seperti tiket 98 (domain HMAC sendiri, tanpa kolom baru), yang menampilkan status Payment apa adanya.
- Rute pendaftaran mengirim `successReturnUrl` dan `cancelReturnUrl` per pembayaran ke halaman itu.

## Comments

- 2026-10-30: dikerjakan. Halaman `/volunteer-trip/hasil/<token>` (tanpa login, noindex, ditambahkan ke robots) menampilkan status Payment Trip Fee apa adanya. Token stateless HMAC atas `${expiresAt}:${registrationId}`, domain `fund-for-indonesia:registration-result:v1`, berlaku 7 hari, tanpa kolom baru. Logika tanda tangan dipindah ke `src/lib/money/result-token-codec.ts` dan dipakai bersama token Donation (domain berbeda, saling tidak berlaku). Rute pendaftaran kini mengirim `successReturnUrl` dan `cancelReturnUrl` (`?batal=1`) per pembayaran. Setelah rilis, URL default Sumopod tetap perlu halaman netral (lihat tiket 98).
