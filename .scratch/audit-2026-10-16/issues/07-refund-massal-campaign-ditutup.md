# 07: refund-massal-campaign-ditutup

**Status:** awaiting-merge

**Blocked by:** none

**Ukuran:** M

**Catatan:** Kode uang dan konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR. Satu `npx vitest run` penuh pada satu waktu (AGENTS.md).

**Keputusan (2026-10-16, kartu keputusan, opsi "Sesuai PRD"):** PRD 7.2, pemicu 1: saat Campaign SUSPENDED atau CANCELLED, satu tindakan Admin mengusulkan Refund untuk seluruh Payment Campaign itu yang dananya belum keluar. Sumber: audit REQ-03.

## Latar

Hari ini satu-satunya pintu Refund per Payment (`POST /api/campaigns/[slug]/refunds`). Setelah Suspension karena penipuan, Admin harus membuat satu Refund per Payment; untuk ratusan Donor itu tidak praktis. Tiket ini menambah satu tindakan massal. Pasangannya, Donation yang settle setelah Campaign ditutup, ada di tiket `rilis-1-benda/80`.

## Desain

**Tanpa perubahan skema, dan tanpa aktor sistem:** pemohonnya Admin yang menekan tombol. Usulan adalah Refund `REQUESTED` biasa (dana dibekukan seketika lewat `createRefund`), alasan diawali `Usulan penutupan Campaign:` plus status Campaign. Persetujuan per Refund tidak berubah: Admin penyetuju berbeda dari pemohon, Admin penyelesai berbeda dari keduanya (tiga Admin berbeda; lihat REQ-12).

Fungsi lapisan uang `proposeCampaignRefunds(prisma, { campaignId, actorAdminId })` di `src/lib/money/refunds.ts` atau berkas pendampingnya:

- Hanya untuk Campaign berstatus efektif SUSPENDED atau CANCELLED; selain itu ditolak dengan galat bertipe (409).
- Satu transaksi per Payment lewat `createRefund`, yang sudah mengambil kunci subjek lalu kunci Payment. Bukan satu transaksi raksasa: satu Payment gagal tidak menggagalkan yang lain, dan hasil dilaporkan per Payment.
- Calon Payment: Payment Donation `PAID` milik Campaign itu, tidak sandbox pada mode live (pola `sandboxModeOf` / `requireNotSandboxInLiveMode`), Donation belum dianonimkan, dan **belum punya Refund yang berdiri** (`STANDING_REFUND_WHERE`). Payment yang Refund-nya REJECTED atau FAILED boleh diusulkan lagi.
- Idempoten: menjalankan dua kali tidak menggandakan usulan; yang kedua melaporkan semuanya `sudahAda`.
- Nominal usulan = Gross Payment (ADR 0007). Refund sebagian tetap lewat pintu per Payment.

**"Dananya belum keluar" dihitung dari buku besar, per Campaign, bukan dari satu kolom.**

1. Payment dengan `escrowReleasedAt IS NULL`: dananya masih di `ESCROW_HOLD`, tidak mungkin sudah di-Payout. Selalu dapat diusulkan.
2. Payment dengan `escrowReleasedAt` terisi: dananya di `CAMPAIGN_BALANCE` dan bisa sudah ditarik Payout. Payout menarik dari kolam Campaign, bukan per Payment, jadi tidak ada bukti per Payment mana yang sudah keluar. Aturan konservatif: ambil `campaignBalance` (sudah dikurangi Payout yang terjurnal dan pembekuan Refund yang berdiri) sebagai batas. Telusuri Payment released dari yang terbaru ke terlama, usulkan selama jumlah bersih yang dibekukan (Gross dikurangi porsi Platform Fee dan Provider Fee) masih muat dalam sisa saldo; sisanya dilewati dengan alasan `sudahKeluar`. Terbaru dulu, karena Payout menguras kolam dari dana tertua.
3. Yang dilewati dilaporkan ke Admin dengan jumlah dan total nominalnya: itu urusan penagihan di luar sistem (PRD 7.2: yang sudah keluar lewat Payout Completed tidak bisa ditarik sistem).

Pengecualian lain dilaporkan, tidak dilempar: `RefundAfterCampaignTransferError` (dana pindah ke Campaign lain), `DonationAnonymisedError`, `DemoCampaignError`, dan Kind terbatas.

**Kind terbatas.** Wakaf, Hibah, dan Zakat hanya boleh Refund dengan tiga alasan teknis (`requireRefundAllowedForKind`, PRD 196). Keputusan koordinator 2026-10-16: pakai frasa terdekat yang benar. `dana masuk setelah Campaign ditutup` hanya untuk Payment yang settle setelah penutupan; Payment yang masuk sebelumnya dilewati dengan alasan `kindTerbatas` dan dilaporkan, tidak dipaksakan.

**Pintu HTTP.** `POST /api/admin/campaigns/[slug]/refund-proposals`, dibungkus `withHiddenAssignmentCheck(Assignment.ADMIN, ...)` agar non-Admin mendapat 404 (`src/__tests__/properties/roles-expand-guard.test.ts`). Admin yang juga pemilik Campaign ditolak oleh `requireNotOwnerAsAdmin` di dalam `createRefund`. Jawaban memuat hitungan: dibuat, sudah ada, dilewati (dengan alasan), gagal.

**UI.** Tombol "Usulkan Refund untuk semua Donor" di halaman Admin Campaign (`/admin/campaigns/lifecycle/[slug]`), tampil hanya untuk SUSPENDED atau CANCELLED, dengan konfirmasi dan ringkasan hasil. Usulan muncul di `/admin/refunds` ("Menunggu persetujuan") dan dikenali dari awalan alasan.

## Pertanyaan terbuka

1. Kind terbatas: apakah usulan karena Suspension/Cancellation boleh memakai alasan `dana masuk setelah Campaign ditutup`? Rekomendasi: ya.
2. Aturan "terbaru dulu" untuk Payment released adalah asumsi konservatif, bukan fakta buku besar. Owner menyetujuinya, atau memilih melewati semua Payment released bila ada Payout yang tidak REJECTED atau FAILED.
3. Tiga Admin berbeda per Refund tetap berlaku (REQ-12): Campaign dengan banyak Donor tetap butuh tiga Admin untuk menyelesaikan satu per satu. Persetujuan massal di luar tiket ini.

## Berkas relevan

- `src/lib/money/refunds.ts`, `src/lib/money/refund-standing.ts`, `src/lib/money/sandbox-mode.ts`
- `src/lib/money/ledger.ts` (`campaignBalance`, `escrowBalance`, `refundRequestedLegs`)
- `src/app/api/campaigns/[slug]/refunds/route.ts` (pola route)
- `src/app/admin/campaigns/lifecycle/[slug]/page.tsx`
- `src/app/admin/refunds/page.tsx`

## Acceptance

- [x] Satu tindakan Admin membuat Refund `REQUESTED` untuk setiap Payment Donation `PAID` Campaign SUSPENDED atau CANCELLED yang dananya belum keluar
- [x] Status selain SUSPENDED/CANCELLED ditolak
- [x] Idempoten: tindakan kedua tidak menggandakan usulan
- [x] Payment sandbox (mode live), belum dibayar, teranonimkan, dan yang dananya sudah keluar dilewati dan dilaporkan dengan alasan
- [x] "Belum keluar" dihitung dari buku besar seperti di atas, dengan tes Payout parsial
- [x] Non-Admin mendapat 404 sebelum masuk fungsi uang (roles-expand-guard hijau)
- [x] Tombol di halaman Admin Campaign dan usulan terlihat di `/admin/refunds`
- [x] Tes Postgres sungguhan
- [ ] Review independen `sonnet` diposting di PR (koordinator)

## Comments

- 2026-10-16: dibuat dari audit REQ-03 dan keputusan owner "Sesuai PRD". Desain ditetapkan di tiket ini tanpa skema; pasangannya tiket `rilis-1-benda/80`.

- 2026-10-16: dibangun di cabang `claude/audit-refund-prd72` (`src/lib/money/campaign-refund-proposals.ts`, route `POST /api/admin/campaigns/[slug]/refund-proposals`, tombol di halaman Admin Campaign). Aturan terbaru-dulu diterima koordinator; sisa "sudah keluar" ditampilkan di hasil dan UI. Status `awaiting-merge`; menjadi `done` saat merge.
