# 77: A-4 admin-campaign-transfers-screen

**Status:** ready-for-agent

**Blocked by:** none; C14 dijawab owner 2026-10-04

**Ukuran:** M

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR.

**Keputusan (2026-10-04, ronde C):** C14 transfer hibah tanpa batas kategori (sesuai rekomendasi).

## Latar

Backend transfer antar Campaign sudah ada (`requestCampaignTransfer`, `approveCampaignTransfer`, `rejectCampaignTransfer`) tetapi Admin tidak punya layarnya. Batas kategori transfer hibah menunggu review syariah.

## Berkas relevan

- `src/lib/money/campaign-transfers.ts`
- `src/app/api/admin/campaign-transfers/route.ts`
- `src/app/api/admin/campaign-transfers/[id]/decision/route.ts`
- `src/lib/mail/campaign-transfer.ts`
- `src/components/admin/AdminSidebar.tsx` (satu baris)
- halaman baru `src/app/admin/campaign-transfers/page.tsx`

## Acceptance

- [ ] Admin melihat daftar permintaan transfer dengan sumber, tujuan, jumlah, dan alasan
- [ ] Admin menyetujui atau menolak; aturan dua orang dan aktor ditegakkan backend dan galatnya tampil
- [ ] Aturan kategori mengikuti C14 (transfer hibah tanpa batas kategori sampai review syariah)
- [ ] Tes halaman, komponen, dan e2e; review independen `sonnet` diposting di PR

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C14 dijawab owner sesuai rekomendasi: transfer hibah tanpa batas kategori sampai ada review syariah. Aturan di `campaign-transfers.ts` (hibah hanya ke hibah, lintas Kind ditolak) tidak berubah; layar hanya menampilkannya. `needs-info` menjadi `ready-for-agent`.
