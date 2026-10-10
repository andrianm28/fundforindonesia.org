# 66: F3 verifier-flag-admin-urgent

**Status:** awaiting-merge

**Blocked by:** none (backend `flagCampaign`, `dismissFlag`, `setUrgent` sudah ada)

**Ukuran:** M

**Catatan:** Layar; tanpa skema. Terkait C10 (Admin menangguhkan tanpa Flag) tetapi tidak bergantung padanya.

## Latar

Verifier tidak punya form untuk memasang Flag dan Admin tidak punya tombol dismiss atau toggle Urgent, padahal route-nya ada.

## Berkas relevan

- `src/lib/campaign-lifecycle.ts` (`flagCampaign` ~1761, `dismissFlag` ~1796, `setUrgent` ~1602)
- `src/app/api/campaigns/[slug]/flags/route.ts`
- `src/app/api/campaigns/[slug]/flags/[id]/dismiss/route.ts`
- `src/app/api/campaigns/[slug]/urgent/route.ts`
- `src/app/moderasi/campaigns/[id]/page.tsx`
- `src/app/admin/campaigns/lifecycle/[slug]/page.tsx` dan `src/components/admin/AdminCampaignLifecycleActions.tsx`

## Acceptance

- [x] Verifier memasang Flag dengan alasan dari layar moderasi Campaign
- [x] Admin melihat Flag aktif dan menolaknya (dismiss) dengan catatan
- [x] Admin menyalakan dan mematikan Urgent dari layar lifecycle
- [x] Aturan aktor dan galat domain dari backend ditampilkan, bukan diduplikasi di UI
- [x] Tes komponen dan satu e2e untuk alur Flag lalu dismiss

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C10 dijawab owner sesuai rekomendasi: Admin boleh menangguhkan Campaign tanpa Flag dari Verifier, asal alasannya tercatat. Itu sudah perilaku `CONTEXT.md` (Suspension) dan ADR 0015, jadi tiket ini tidak berubah dan tetap tidak bergantung padanya; layar Flag tidak boleh menjadikan Flag prasyarat Suspension.

- 2026-10-10: awaiting-merge. Branch `claude/rilis-1-66-verifier-flag-admin-urgent`. Tanpa skema; semantik backend tidak berubah.
  - **Seam yang diuji** (builder tidak bisa meminta persetujuan seam, jadi ditetapkan dan dicatat di sini): props dan DOM tiap komponen dengan `fetch` sebagai batas sistem; render halaman server dengan Prisma ditiru; satu alur e2e di peramban sungguhan.
  - Verifier: `CampaignFlagForm` di `/moderasi/campaigns/[id]`, tampil bila status efektif ada di `FLAGGABLE` (daftar modul lifecycle, kini diekspor; Active, Expired, Completed menurut ADR 0015). Alasan dikirim ke `POST .../flags`; galat server tampil apa adanya.
  - Admin, `/admin/campaigns/lifecycle/[slug]`: seksi "Flag terbuka" (alasan, Verifier, waktu WIB) dengan form tolak per Flag ke `POST .../flags/[id]/dismiss`; seksi Urgent (Pasang/Lepas) ke `PUT .../urgent`. Seksi Flag tampil walau Campaign tidak bisa di-suspend (dismiss tidak bergantung status). Menjatuhkan Suspension tetap tidak mensyaratkan Flag (C10).
  - Tidak ada aturan aktor atau status yang disalin ke UI: kedua seksi baru tidak membaca `isOwnCampaign`; tombol "Pasang Urgent" ditampilkan menurut `URGENT_SETTABLE_FROM` (konstanta baru, dipakai juga oleh `setUrgent` sehingga tidak ada dua daftar). "Lepas Urgent" selalu ada selama Urgent menyala.
  - Keputusan builder (menunggu konfirmasi owner): Flag tidak dikirim ke halaman bila Admin itu sendiri Fundraiser Campaign-nya (Fundraiser tidak diberi tahu soal Flag; sebelumnya daftar itu ikut tersembunyi di balik catatan "Campaign milik Anda sendiri").
  - Satu tautan "Kelola" ditambahkan di tabel `/admin/campaigns` supaya layar lifecycle terjangkau untuk Campaign Active tanpa Flag (antrean lifecycle hanya memuat yang ber-Flag, Suspended, atau ada pengajuan Cancellation). Bila F4 mengubah baris itu, tautan ini yang mengalah.
  - e2e `tests/e2e/flag-dismiss.spec.ts`: seed menambah Verifier dan Admin ber-sandi (sandi sekali pakai untuk DB sekali pakai); spec masuk lewat endpoint kredensial NextAuth, memasang Flag dari layar moderasi, lalu Admin menolaknya dari layar lifecycle, termasuk baca ulang halaman. Lulus 9 kali berturut-turut (3 viewport) terhadap bundel produksi lokal; login dibatasi 10 per akun per 15 menit, jadi jangan menambah login tanpa menghitung.
  - **Butuh keputusan owner**: Verifier belum punya daftar Campaign untuk dipilih; form Flag hanya terjangkau dari antrean Verifikasi Tambahan, petunjuk duplikat, atau tautan langsung. Perlu tiket lanjutan bila Flag harus bisa dipasang pada sembarang Campaign Active.
  - Temuan di luar tiket: `PageTransition` memasang isi halaman dua kali (~200 ms setelah navigasi), yang mengosongkan form yang sudah diketik dan membuat `main-flows.spec.ts` "hero banner" kadang gagal di lokal (strict mode, dua elemen). Tidak diubah di sini.
