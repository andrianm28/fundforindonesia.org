# 02: Gerbang wakaf dan hibah (WAKAF_HIBAH_OPEN)

**Latar:** Audit 2026-10-16, temuan legal L1 dan T2. Keputusan owner: tidak ada uang wakaf/hibah sebelum ada nazhir berizin dan tinjauan syariah tercatat. Gerbang donasi sampai kini hanya bergantung pada Kind Authorisation, yang buktinya teks bebas; ADR 0013 sendiri menyebut aturan hibah masih sementara.

**Blocked by:** none

**Status:** done

- [x] Variabel env server `WAKAF_HIBAH_OPEN` bawaan mati; hanya nilai persis `true` yang membuka (tanpa perubahan skema)
- [x] `collectingEntityBlock` mengembalikan `KIND_CLOSED` untuk Campaign WAKAF/HIBAH saat mati, sebelum cek entity, permit, dan Kind Authorisation; `campaignAcceptsDonations` dan `donationBlock` ikut menolak
- [x] POST `/api/donations`, `/api/donations/[id]/retry`, dan halaman donasi menampilkan pesan Indonesia tersendiri (`KIND_CLOSED_REFUSAL`)
- [x] Donasi biasa tidak terpengaruh saat mati; saat `true` perilaku sama seperti sebelumnya
- [x] Pembuatan dan persetujuan Draft (`requireOpenable`) tidak diubah: Draft tetap bisa dibuat dan disetujui, hanya penerimaan uang yang ditutup
- [x] `.env.example` dan `docs/runbooks/beta-ke-live.md` mendokumentasikan variabel; tetap mati sampai nazhir dan tinjauan syariah tercatat
- [x] Tes: mati (wakaf dan hibah diblokir, nilai selain `true` dianggap mati), mati (donasi normal), hidup (tanpa perubahan), dan satu tes rute

## Comments

2026-10-16 (builder): Saklar dibaca saat dipanggil dari `process.env`, jadi mengubahnya cukup dengan restart. Belum dikerjakan (bagian lain L1): nomor registrasi nazhir BWI terstruktur, referensi tinjauan syariah yang hanya bisa diisi Admin, dan penampilannya di Akad Wakaf dan halaman Campaign.
