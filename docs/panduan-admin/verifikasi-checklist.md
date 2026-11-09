# Verifikasi checklist

**Layar:** Admin > Checklist Verifikasi (`/admin/verification-checklist`).
**Siapa:** Admin menyusun; Verifier memakainya saat meloloskan pengajuan.

Checklist adalah daftar butir yang harus dicentang Verifier sebelum meloloskan sebuah Campaign (PRD 7.1).

## Mengubah checklist

1. Buka layar. Tiap butir menampilkan label, wajib atau tidak, **Kind** (Semua, Donasi, Wakaf, Hibah), urutan, dan status aktif.
2. **Menambah butir**: isi label, pilih apakah wajib, pilih Kind (kosong berarti berlaku untuk semua Kind), dan pilih apakah butir **memerlukan dokumen** (Verifier baru boleh mencentangnya setelah Fundraiser mengunggah dokumen untuk butir itu). Simpan.
3. **Mengubah urutan**: gerakkan butir naik atau turun.
4. **Menonaktifkan** butir bila tidak dipakai lagi. Butir tidak pernah dihapus.

## Hal yang perlu diwaspadai

- Perubahan berlaku **hanya untuk pengajuan berikutnya**. Pengajuan yang sudah masuk tetap memakai checklist saat ia diajukan.
- Butir bertipe Kind hanya diperiksa pada Campaign Kind itu; butir "Semua" diperiksa pada setiap Kind.
- Butir wajib yang belum tercentang menahan tombol **Loloskan** di panel Moderasi.
- Menonaktifkan butir wajib melonggarkan syarat meloloskan: lakukan dengan sengaja dan catat alasannya di catatan operasional.
- Layar ini hanya untuk Admin. Verifier tidak bisa mengubah checklist, hanya mencentangnya.
