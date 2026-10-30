# Runbook: rotasi key enkripsi field (ADR 0012)

Tanpa flag day dan tanpa perubahan skema. Setiap nilai menyimpan id key yang menyegelnya, jadi key lama cukup tetap dimuat untuk dibaca. Langkah yang menyentuh host produksi dikerjakan **owner**. Jangan menaruh key sungguhan di repo (repo ini publik) atau di `.scratch/`.

## Variabel

| Variabel | Isi |
| --- | --- |
| `FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID` | key enkripsi **saat ini**: dipakai semua tulis baru |
| `FIELD_HMAC_KEY`, `FIELD_HMAC_KEY_ID` | key HMAC email **saat ini** |
| `FIELD_ENCRYPTION_PREVIOUS_KEYS` | key enkripsi pensiun, `id:base64key,id:base64key`; hanya untuk membaca |
| `FIELD_HMAC_PREVIOUS_KEYS` | key HMAC pensiun, format sama; hanya untuk pencarian email |

Aturan yang ditolak saat boot (pesan menyebut nama variabel, tidak pernah nilainya): key bukan 32 byte, id ganda di antara key saat ini dan pensiun, id enkripsi sama dengan id HMAC, satu secret dipakai untuk dua tugas.

## Langkah

1. Buat key baru, masing-masing terpisah: `openssl rand -base64 32`. Pilih id baru yang belum pernah dipakai (mis. `enc-2026-11`, `hmac-2026-11`).
2. Di `.env` host: pindahkan key dan id lama ke `*_PREVIOUS_KEYS` (`id:base64key`, pisahkan beberapa dengan koma), lalu isi empat variabel saat ini dengan key dan id baru.
3. Deploy seperti biasa (owner yang men-dispatch). Boot gagal bila ada aturan di atas yang dilanggar.
4. Verifikasi: login dengan akun lama (email dicari lewat HMAC lama), buka panel yang menampilkan email, telepon, dan rekening lama; daftarkan akun uji dan pastikan barisnya memakai id baru.

Sejak deploy, baris lama tetap terbaca dan baris baru memakai key baru. Boleh berhenti di sini.

## Batas yang perlu diketahui

- **Key pensiun jangan dibuang** selama masih ada baris yang menyebut id-nya. Id yang tidak dikenal membuat dekripsi gagal, dan backup lama butuh key pensiun saat restore (lihat `restore.md`).
- **Belum ada skrip re-encrypt.** Baris lama tidak otomatis pindah ke key baru. Itu pekerjaan lanjutan; cek baris yang masih memakai id lama dengan `SELECT "emailKeyId", count(*) FROM "User" GROUP BY 1` (juga kolom `*KeyId` dan `*HmacKeyId` di tabel lain).
- Klaim riwayat Guest Donor mencocokkan HMAC dari semua key (saat ini dan pensiun), jadi akun dan donasi tamu yang di-hash dengan key berbeda tetap saling cocok.
- Anonimisasi Guest Donor mencocokkan email lewat key yang menyegel HMAC tersimpan, jadi tetap bekerja untuk baris lama.
