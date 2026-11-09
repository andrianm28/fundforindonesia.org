# 06: Halaman publik profil lembaga + nomor izin

**Blocked by:** None

**Status:** done

**What to build:** Pasal 12(5) meminta halaman publikasi profil lembaga serta nomor izin. Nomor izin (FundraisingPermit) kini hanya terlihat di /moderasi. Buat /lembaga/[id] (atau slug) publik yang menampilkan nama lembaga, nomor izin penghimpunan yang berlaku beserta penerbit dan masa berlaku, dan daftar Campaign aktifnya. Tautkan dari 'Dihimpun oleh' di halaman Campaign dan halaman donasi. Jangan tampilkan dokumen, data kontak pribadi, atau rekening. Izin yang kedaluwarsa ditandai jelas.

- [x] Test: halaman hanya menampilkan field publik
- [x] Test: lembaga tanpa izin berlaku menampilkan status yang jujur

## Comments

- Halaman `/lembaga/[id]` (en: `/organisation/[id]`) memakai `getOrganisationProfile` (`src/lib/organisation-profile.ts`) yang hanya meng-select nama, nomor izin, penerbit, jenis, masa berlaku, dan Campaign aktif yang boleh dilist publik (`listableCampaignWhere`). Tidak ada dokumen, kontak, akun penggalang, atau rekening.
- Status izin per baris: Berlaku / Kedaluwarsa / Belum berlaku; tingkat lembaga: ada izin berlaku, tidak ada yang berlaku, atau belum ada izin tercatat. Data izin dummy di produksi dirender apa adanya.
- "Dihimpun oleh" kini tertaut di halaman donasi dan baru ditambahkan di halaman Campaign (sebelumnya tidak menampilkan lembaga). Profil masuk sitemap dan peta pathname i18n.
- Code review (dilakukan builder sendiri, tanpa sub-agent): `coverImage` yang tak terpakai dibuang dari daftar Campaign. Belum ada review independen.
