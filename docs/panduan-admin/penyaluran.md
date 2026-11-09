# Penyaluran (Payout)

**Layar:** Admin > Pencairan Dana (`/admin/payouts`, detail `/admin/payouts/[id]`).
**Siapa:** Admin. Fundraiser mengajukan dari akunnya (`/akun/kampanye-saya/[slug]/pencairan`).

Payout mengirim sebagian saldo Campaign (atau Volunteer Trip) ke rekening **terverifikasi** Fundraiser. Antrean memuat dua kelompok: **Menunggu persetujuan** (DRAFT) dan **Menunggu penyelesaian** (APPROVED). Yang sudah diputuskan tidak tampil di antrean.

## Menyetujui (Admin pertama)

1. Buka Payout DRAFT. Periksa Campaign, nominal, dan rekening tujuan.
2. Di dashboard penyedia, baca saldo penyedia saat ini. Isi **penyedia** dan **saldo** itu di formulir: keduanya wajib, karena tidak ada API saldo; sistem menolak persetujuan bila saldo tidak cukup.
3. **Setujui pencairan**. Uang dicatat keluar dari saldo Campaign saat persetujuan.
4. Bila saldo penyedia ternyata kurang, jangan memaksa: pakai **Catat: saldo penyedia kurang** agar ada jejak bahwa sudah diperiksa; baris itu diberi catatan di antrean.
5. Payout yang tidak seharusnya jalan: **Tolak Payout** dengan alasan.

## Menyelesaikan (Admin kedua, berbeda dari penyetuju)

1. Buka Payout APPROVED. Admin penyetuju hanya melihat kalimat aturan dua orang, tanpa tombol.
2. Gunakan **tombol buka nomor rekening** untuk melihat nomor lengkap (tidak ada di payload halaman; tiap pembukaan dicatat audit). Tarik dana dari dashboard penyedia ke rekening itu.
3. Isi **bukti transfer**: referensi transaksi dan catatan, keduanya wajib bermakna (bukan satu karakter). Simpan sebagai selesai.
4. Setelah Payout Campaign selesai, Fundraiser mengirim Usage Report. Panel di halaman Payout memungkinkan Admin menandainya **dipertanyakan** dengan alasan; keduanya langsung publik dan tidak bisa dicabut.

## Hal yang perlu diwaspadai

- **Dua orang**: pengaju tidak bisa menyetujui, penyetuju tidak bisa menyelesaikan.
- Payout hanya untuk Campaign Active, Expired, atau Completed. Suspended dan Cancelled menolaknya, termasuk bila Suspension jatuh di antara pengajuan dan persetujuan.
- Payout Trip Fee hanya atas dana Volunteer Batch yang sudah `COMPLETED`, dan ditolak untuk Trip Suspended.
- Rekening harus sudah diverifikasi Verifier ([partner-organisation-dan-izin.md](partner-organisation-dan-izin.md)).
- Selama mode Beta, uang sandbox tidak pernah menjadi Payout nyata.
- Setelah menarik dana dari penyedia, catat penarikannya di [rekonsiliasi.md](rekonsiliasi.md).
