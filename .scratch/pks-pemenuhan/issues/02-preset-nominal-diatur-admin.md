# 02: Preset nominal donasi diatur Admin

**Blocked by:** None

**Status:** done

**What to build:** Preset nominal di halaman donasi di-hardcode `[20000, 50000, 100000, 250000, 500000]` (src/app/campaign/[slug]/donate/page.tsx:17). Jadikan daftar ini setelan Admin (3–8 nilai bilangan bulat rupiah, unik, terurut, masing-masing >= minimum donasi) yang disimpan di modul setelan operasional tiket 01 (key `donationPresets`) atau modul serupa, default = nilai sekarang. Halaman donasi membaca dari server. Galat minimum yang sudah ada tetap menampilkan nilai minimum (4.6(2)).

- [x] Test validasi: nilai < minimum, duplikat, > 8 nilai ditolak
- [x] Test: halaman donasi memakai preset tersimpan, jatuh ke default bila baris rusak/kosong
- [x] Layar Admin untuk mengubah preset, non-Admin 404

## Comments

- Preset disimpan sebagai key `donationPresets` di baris `operations` (src/lib/operations.ts), bukan modul baru. Validasi: 3-8 bilangan bulat, unik, masing-masing >= `MIN_DONATION_AMOUNT` dan <= Rp1 miliar; disimpan terurut naik. Nilai rusak/kosong/baris lama jatuh ke default hanya untuk preset (`.catch`), saklar tetap seperti tersimpan.
- Halaman donasi (client) membaca lewat `DonationPresetsProvider` yang diisi `donate/layout.tsx` (server). Galat minimum tetap memakai `MIN_DONATION_AMOUNT`.
- Layar: field "Preset nominal donasi" di /admin/operasional; non-Admin tetap 404 (route dan layout Admin tidak diubah). Form kini hanya mengirim field yang berubah.
- Tambahan koordinator (review tiket 01): `setOperations` kini compare-and-set (`updateMany` where `updatedAt` lama; `create` untuk baris pertama, P2002 jadi konflik). Gagal -> `OperationsConflictError` -> 409 "Setelan berubah, muat ulang halaman lalu coba lagi." Berlaku untuk semua field termasuk preset.
- operations.ts kini mengimpor `MIN_DONATION_AMOUNT` dari donations.ts; mock `@/lib/donations` di test volunteer-trips registrations ditambah konstanta itu.
