# 98: Setelah membayar di Sumopod, Guest Donor tidak punya halaman tujuan

**Type:** task

**Status:** needs-triage

**Blocked by:** none

Ditemukan saat mengisi "Payment Redirect URLs" di dashboard Sumopod sandbox untuk UAT Beta, 2026-10-16.

## Masalah

- `src/lib/money/donation-charge.ts` memanggil `provider.createCharge` tanpa `successReturnUrl` atau `cancelReturnUrl`, padahal `sumopod-provider.ts` sudah meneruskan keduanya sebagai `success_return_url` dan `cancel_return_url`. Akibatnya Sumopod selalu memakai URL default dari dashboard, yang sama untuk semua Campaign dan semua Donor. Hal yang sama berlaku untuk pembayaran Volunteer Trip (`src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts`).
- Satu-satunya halaman yang cocok sebagai default adalah `/donasi-saya`, tetapi halaman itu mewajibkan login. Guest Donor yang selesai membayar akan dilempar ke `/login`, tanpa konfirmasi bahwa donasinya diterima.
- Untuk UAT, dashboard sandbox diisi Success `https://fundforindonesia.org/donasi-saya` dan Cancel `https://fundforindonesia.org/`.

## Kriteria penerimaan

- Ada halaman hasil pembayaran per Donation yang bisa dibuka Guest Donor tanpa login. Halaman ini tidak boleh membocorkan data Donation lain: aksesnya memakai token yang tidak bisa ditebak, bukan id berurutan, dan tidak menampilkan data pribadi selain yang dimasukkan Donor sendiri.
- Halaman itu menampilkan status Payment apa adanya (menunggu, berhasil, gagal, kedaluwarsa), karena redirect sukses dari penyedia **bukan** bukti pembayaran. Status hanya berubah lewat webhook bertanda tangan.
- `donation-charge.ts` mengirim `successReturnUrl` dan `cancelReturnUrl` per pembayaran ke halaman itu. Halaman batal menawarkan "coba bayar lagi" pada Donation yang sama.
- Volunteer Trip mendapat perlakuan yang sama, atau dicatat sebagai tiket terpisah bila halamannya berbeda.
- Setelah dirilis, URL default di dashboard Sumopod (sandbox dan produksi) diganti ke halaman netral yang tidak mewajibkan login.

## Comments
