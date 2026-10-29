# 98: Setelah membayar di Sumopod, Guest Donor tidak punya halaman tujuan

**Type:** task

**Status:** done

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

- 2026-10-16: dikerjakan (thread "Halaman hasil pembayaran donor tamu"). Halaman `/donasi/hasil/<token>`; token stateless HMAC atas `${expiresAt}:${donationId}` dengan kunci turunan NEXTAUTH_SECRET (domain `fund-for-indonesia:payment-result:v1`), berlaku 30 hari, tanpa kolom baru dan tanpa migrasi. `chargeDonation` mengirim URL sukses dan batal (`?batal=1`) per Payment dan kini menyimpan `Payment.redirectUrl`, sehingga Donor yang batal bisa kembali ke tagihan yang sama selama masih terbuka; tagihan gagal atau kedaluwarsa ditawari "Coba bayar lagi" lewat `POST /api/donations/[id]/retry`. Volunteer Trip dipisah ke tiket 99. Setelah rilis, owner mengganti URL default Success di dashboard Sumopod ke beranda.
- 2026-10-16, setelah self-review: halaman sengaja tidak menautkan Receipt (token Receipt tidak kedaluwarsa dan Receipt memuat nama Donor; bukti tetap dikirim lewat email). Nomor VA kini ikut disimpan di `Payment.vaNumber` dan ditampilkan selama tagihan terbuka. Selama tagihan masih terbuka, halaman batal menawarkan "Lanjutkan pembayaran" ke tagihan yang sama, bukan "Coba bayar lagi", karena rute retry menolak (409) Payment yang belum kedaluwarsa.
- 2026-10-16, setelah review independen (S1-S4): "Coba bayar lagi" kini lewat `POST /api/donations/result/<token>/retry`; rute lama `/api/donations/<id>/retry` tidak lagi menerima Donation tamu (id bukan kredensial). Aturan retry dipindah ke `src/lib/donation-retry.ts`: kunci advisory per Donation dengan try-lock (retry paralel kedua dijawab 409, terbukti di tes Postgres asli), masa tenggang 15 menit setelah `expiresAt` sebelum tagihan baru ditawarkan, rate limit per alamat, dan tombol disembunyikan bila Campaign tidak bisa menerima donasi. TTL token turun ke 7 hari.

- 2026-10-16, setelah re-review (R1-R3): paling banyak 3 retry berjalan bersamaan per proses (`MAX_RETRIES_IN_FLIGHT`); sisanya langsung dijawab 503, karena tiap retry memegang dua koneksi pool dan 14 retry lintas donasi sebelumnya macet (terbukti di tes Postgres asli, gagal tanpa batas ini). Panggilan `createCharge` Sumopod kini berbatas waktu 25 detik (`AbortSignal.timeout`), jauh di bawah timeout transaksi 60 detik. Flip lazy EXPIRED ditulis lewat klien root sehingga tidak memegang kunci baris Payment lama selama panggilan penyedia.
- 2026-10-16, re-review df4424b lulus. Nit N7 dikerjakan: cek batas retry kini sebelum rate limit, jadi jawaban "sibuk" tidak memakan kuota 30/jam. Ditambah tes slot dilepas saat retry melempar error dan tes flip EXPIRED yang gagal. N6 (log/alert webhook untuk orderId tak dikenal), N8 (batas per proses) dan N9 menjadi tindak lanjut.
- 2026-10-29: #273 di-merge (dd7b08a). Atas permintaan owner, halaman konfirmasi kini juga menampilkan nomor referensi (order id di Sumopod), metode pembayaran, dan waktu pembayaran (WIB) dari Payment yang dibayar, atau dari percobaan terbaru bila belum dibayar. Nomor referensi memuat id Donation; ini aman karena id itu sudah terbaca dari token dan sejak S2 bukan lagi kredensial.
