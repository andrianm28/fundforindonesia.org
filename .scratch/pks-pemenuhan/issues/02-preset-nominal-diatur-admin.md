# 02: Preset nominal donasi diatur Admin

**Blocked by:** None

**Status:** ready-for-agent

**What to build:** Preset nominal di halaman donasi di-hardcode `[20000, 50000, 100000, 250000, 500000]` (src/app/campaign/[slug]/donate/page.tsx:17). Jadikan daftar ini setelan Admin (3–8 nilai bilangan bulat rupiah, unik, terurut, masing-masing >= minimum donasi) yang disimpan di modul setelan operasional tiket 01 (key `donationPresets`) atau modul serupa, default = nilai sekarang. Halaman donasi membaca dari server. Galat minimum yang sudah ada tetap menampilkan nilai minimum (4.6(2)).

- [ ] Test validasi: nilai < minimum, duplikat, > 8 nilai ditolak
- [ ] Test: halaman donasi memakai preset tersimpan, jatuh ke default bila baris rusak/kosong
- [ ] Layar Admin untuk mengubah preset, non-Admin 404
