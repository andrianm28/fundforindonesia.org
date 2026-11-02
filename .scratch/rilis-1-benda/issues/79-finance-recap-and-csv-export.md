# 79: A-6 finance-recap-and-csv-export

**Status:** done

**Blocked by:** none; C15 dijawab owner 2026-10-04

**Ukuran:** M

**Catatan:** Laporan uang baca-saja; tanpa skema. Review independen `sonnet` karena angka keuangan.

**Keputusan (2026-10-04, ronde C):** C15 rekap per periode x Kind x Campaign plus ekspor CSV (sesuai rekomendasi).

## Latar

PRD section 9 meminta rekap keuangan dan ekspor CSV. Dimensi rekap menunggu keputusan.

## Berkas relevan

- `src/lib/money/impact.ts`
- `src/lib/money/ledger.ts`
- `src/app/admin/page.tsx`
- route dan halaman baru di `src/app/admin/finance/`

## Acceptance

- [ ] Rekap per periode x Kind x Campaign sesuai C15, sama dengan jumlah di buku besar
- [ ] Ekspor CSV dengan kolom yang sama, aman dari injeksi formula (sel diawali `=`, `+`, `-`, `@` dinetralkan)
- [ ] CSV tanpa data pribadi donor
- [ ] Tes terhadap Postgres sungguhan untuk kecocokan total; hanya ADMIN

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C15 dijawab owner sesuai rekomendasi: rekap per periode x Kind x Campaign, plus ekspor CSV. Acceptance di atas sudah memakai bentuk itu. `needs-info` menjadi `ready-for-agent`.

- 2026-10-30 (builder): dikerjakan di cabang `claude/project-thread-dcqhpw-t79`, belum didorong. Halaman `/admin/finance` (rekap per bulan WIB x Kind x Campaign, filter dari/sampai bulan), ekspor `GET /api/admin/finance/recap` (CSV kolom sama + baris Total; sel teks diawali `= + - @ \t \r` diberi apostrof; tanpa data donor), entri AdminSidebar "Rekap Keuangan". Hanya ADMIN (404 untuk selain Admin). Definisi tiap kolom terhadap buku besar ada di komentar `src/lib/money/finance-recap.ts` (`classifyMovement`): hanya uang sungguhan (`sandbox = false`); leg tanpa `campaignId` dikaitkan lewat leg lain pada `transactionId` yang sama; Volunteer Trip/Program masuk baris "Tanpa Campaign". Catatan teknis: `LedgerEntry.createdAt` bertipe `timestamp` tanpa zona berisi UTC, jadi bulan WIB dihitung `AT TIME ZONE 'UTC'` lalu `'Asia/Jakarta'` (tes batas 16:59:59Z/17:00:00Z di tes Postgres sungguhan). Review independen `sonnet` masih diperlukan (angka keuangan). Status tidak diubah.

- 2026-10-30: merged ke `main` lewat #308 (bdd0fc2) setelah CI hijau dan review independen bersih. Live setelah owner men-deploy `main`.
