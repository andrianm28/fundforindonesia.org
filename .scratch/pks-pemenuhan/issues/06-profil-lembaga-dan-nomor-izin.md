# 06: Halaman publik profil lembaga + nomor izin

**Blocked by:** None

**Status:** ready-for-agent

**What to build:** Pasal 12(5) meminta halaman publikasi profil lembaga serta nomor izin. Nomor izin (FundraisingPermit) kini hanya terlihat di /moderasi. Buat /lembaga/[id] (atau slug) publik yang menampilkan nama lembaga, nomor izin penghimpunan yang berlaku beserta penerbit dan masa berlaku, dan daftar Campaign aktifnya. Tautkan dari 'Dihimpun oleh' di halaman Campaign dan halaman donasi. Jangan tampilkan dokumen, data kontak pribadi, atau rekening. Izin yang kedaluwarsa ditandai jelas.

- [ ] Test: halaman hanya menampilkan field publik
- [ ] Test: lembaga tanpa izin berlaku menampilkan status yang jujur
