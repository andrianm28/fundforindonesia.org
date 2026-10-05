# 90: A-7 admin-escrow-hold-setting

**Status:** ready-for-agent

**Blocked by:** none. Satu PR skema pada satu waktu (menambah tabel); timestamp migrasi dibagi koordinator.

**Ukuran:** M, skema

**Catatan:** Kode uang: wajib review independen `sonnet` dengan bukti diposting di PR. Skema: menyentuh `prisma/schema.prisma`/migrasi. `CONTEXT.md` dan PRD diedit koordinator, bukan builder.

## Latar

Keputusan owner 2026-10-04 (ronde C, C18): lama Escrow Hold adalah **setelan Admin**, bukan konstanta. Rekomendasi awal (konstanta 7 hari, amandemen FFI-17) **ditolak**; PRD FFI-17 tetap seperti ditulis ("lama Escrow Hold" dapat diubah Admin dari dashboard).

Hari ini lama itu konstanta `ESCROW_HOLD_DAYS` (`src/lib/money/escrow.ts`), disalin ke kolom `Payment.escrowHoldDays` saat Payment dibuat (`src/lib/money/donation-charge.ts`; jalur Trip Fee di route registrasi Volunteer). Saat settlement kode membaca nilai yang sudah dibekukan di Payment, bukan konstanta, jadi mengubah default tidak menggeser Payment yang sudah ada. Pola itu dipertahankan; yang baru adalah sumber nilainya dan panel untuk mengubahnya.

PRD FFI-17 juga menyebut Campaign bencana boleh memakai Escrow Hold yang dipendekkan.

## Berkas relevan

- `src/lib/money/escrow.ts` (`ESCROW_HOLD_DAYS`, pelepasan escrow)
- `src/lib/money/donation-charge.ts` (penyalinan ke Payment)
- `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts` (Payment Trip Fee)
- `prisma/schema.prisma` (`Payment.escrowHoldDays`; tabel riwayat baru)
- `src/lib/money/platform-fee-config.ts` (pola append-only: baris baru, bukan mutasi; pelaku dan waktu)
- `src/components/admin/AdminSidebar.tsx` (satu baris) dan halaman baru di `src/app/admin/`
- `src/components/campaign/CampaignDetailView.tsx` dan `src/app/campaign/[slug]/page.tsx` (nilai yang berlaku tampil ke Donor)
- `.scratch/percepatan-full-rilis/keputusan-ronde-c.md` (C18)

## Acceptance

- [ ] Nilai default Escrow Hold diambil dari setelan Admin; bila belum pernah diatur, jatuh ke 7 hari (nilai sekarang) sehingga perilaku tanpa setelan tidak berubah
- [ ] Nilai yang berlaku **disalin ke `Payment.escrowHoldDays` saat Payment dibuat** (donasi dan Trip Fee) dan tidak pernah dihitung ulang; mengubah setelan tidak menggeser Payment yang sudah ada; tes membuktikannya
- [ ] Setelan bersifat append-only: tiap perubahan menulis baris baru berisi nilai, **aktor (Admin)**, dan waktu; riwayat dapat dibaca di layar; tidak ada penyuntingan baris lama
- [ ] Panel Admin untuk membaca nilai berlaku, mengubahnya, dan melihat riwayat; hanya ADMIN, yang lain 404; validasi batas bawah dan atas yang masuk akal dan ditolak di server dengan galat domain (nilai batas diputuskan builder dan dicatat di PR; nol atau negatif tidak boleh)
- [ ] Pertimbangan per Category dinilai dan hasilnya dicatat di PR: PRD FFI-17 memungkinkan override per Category (bencana dipendekkan). Bila dibangun, urutan resolusi mengikuti pola Platform Fee (override Category, lalu default) dan tiap override tercatat dengan aktor; bila tidak dibangun di tiket ini, pecah menjadi tiket lanjutan dengan alasan tertulis
- [ ] Nilai yang berlaku tampil kepada Donor sebelum membayar (sudah ada untuk konstanta; harus mengikuti nilai baru)
- [ ] Perubahan pada pelepasan escrow tidak membuka dana lebih awal bagi Payment yang dibekukan dengan nilai lebih panjang; tes uang dengan Postgres sungguhan, termasuk perubahan nilai di tengah masa hold
- [ ] Tes unit, tes route, dan e2e; ratchet lint dan tsc tidak naik
- [ ] Review independen `sonnet` (kode uang) diposting di PR

## Comments

- 2026-10-04 (ronde C): ditulis koordinator dari keputusan owner C18 (`percepatan-full-rilis/keputusan-ronde-c.md`). Tiket baru, bukan bagian rencana awal (rencana mengusulkan konstanta). Menyimpang dari rekomendasi, atas keputusan owner.
