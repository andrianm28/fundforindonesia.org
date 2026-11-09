# 07: Registrasi: WhatsApp, profil individu/lembaga, persetujuan tersimpan

**Blocked by:** 05 (slot skema)

**Status:** ready-for-agent

**What to build:** Pasal 3.1: form daftar dan pengaturan profil menerima nomor WhatsApp (opsional, divalidasi format Indonesia, disimpan di `phoneCiphertext` yang sudah ada), pilihan jenis profil Individu/Lembaga (kolom baru; Lembaga tetap perlu didaftarkan Verifier sebagai Partner Organisation), dan dua centang wajib Syarat Layanan + Kebijakan Privasi. Simpan catatan persetujuan (versi dokumen, waktu) per pengguna. Login Google juga harus melewati persetujuan pada login pertama.

- [ ] Test: daftar tanpa centang ditolak di API
- [ ] Test: persetujuan tersimpan dengan versi + waktu
- [ ] Test: WhatsApp tersimpan terenkripsi dan bisa diubah di pengaturan
