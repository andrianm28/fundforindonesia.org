# 80: M-d refund-diusulkan-untuk-dana-masuk-setelah-Campaign-ditutup

**Status:** needs-info

**Blocked by:** keputusan owner tentang aktor sistem (lihat "Pertanyaan terbuka"); `.scratch/audit-2026-10-16/issues/07-refund-massal-campaign-ditutup.md` boleh jalan lebih dulu

**Ukuran:** S-M

**Catatan:** Review uang/konkurensi: wajib review independen `sonnet` dengan bukti diposting di PR.

**Keputusan (2026-10-16, kartu keputusan, opsi "Sesuai PRD"):** PRD 7.2 dijalankan seperti tertulis. Pemicunya adalah **status Campaign**, bukan status Payment.

## Latar

Ditulis ulang 2026-10-16. Versi 2026-10-04 menyasar Payment yang settle setelah kedaluwarsa. Itu bertentangan dengan ADR 0021 dan `CONTEXT.md` (Settlement): Payment Donation yang dibayar setelah EXPIRED atau FAILED tetap Settlement dan **tidak** di-refund. Aturan itu tentang Payment dan tetap berlaku; tiket ini tidak menyentuhnya. Trip Fee juga tidak berubah (Refund otomatis, tiket 40 dan 43).

Yang dicatat PRD 7.2 (Pemicu) adalah peristiwa pada Campaign:

| Donation settle ketika Campaign | Hasil |
| --- | --- |
| SUSPENDED atau CANCELLED | Otomatis masuk antrean Refund, alasan memuat status Campaign-nya |
| COMPLETED atau EXPIRED | Diusulkan sistem, Admin memutuskan |

Webhook tetap menerima dan mencatat Settlement apa pun status Campaign-nya (PRD 7.2, paragraf terakhir "Pemicu"). Hari ini webhook tidak punya cabang atas `lifecycleStatus` sama sekali (REQ-03).

## Desain

**Representasi "diusulkan": Refund berstatus `REQUESTED`, tanpa perubahan skema.** `REQUESTED` sudah berarti "dibuat, nominal ditetapkan, dana dibekukan lewat jurnal, menunggu persetujuan Admin lain" (PRD 7.2, Siklus status). Usulan hanyalah Refund `REQUESTED` yang pemohonnya sistem dan alasannya menyebut status Campaign. Admin menyetujui atau menolaknya lewat `/admin/refunds/[id]` yang sudah ada; menolak mengembalikan dana lewat jurnal cermin (tiket 49). Aturan persetujuan per Refund tidak berubah (`src/lib/money/refunds.ts`).

Karena `createRefund` membekukan dana seketika, usulan juga membekukannya. Itu disengaja: dana yang diusulkan kembali tidak boleh bisa ikut Payout. Bila Admin menolak, dana kembali ke Campaign Balance.

Pembuatnya `createRefund`, di dalam transaksi **terpisah** dari transaksi Settlement (urutan kunci Campaign lalu Payment; kunci Payment tidak boleh diambil dari dalam `tx` Settlement, alasan yang sama dengan `refundLateSettlement` Trip Fee).

Idempoten: tidak membuat usulan bila Payment itu sudah punya Refund yang masih berdiri (`STANDING_REFUND_WHERE`). Replay webhook sudah berhenti di `settled: false`, dan cek ini membuat jalur ini aman sekalipun dipanggil ulang.

Kegagalan membuat usulan tidak boleh melempar ke webhook: ditangkap, dicatat (`sanitizeError`), dan diberi tanda `WEBHOOK_OUTCOME` yang bisa dicari Admin, sama dengan pola `LATE_SETTLEMENT_REFUND_FAILED`. Tetap 200 ke penyedia.

Tidak mengubah Settlement: Payment tetap `PAID`, jurnal `paymentSettledLegs` tetap terbit.

Aturan Kind (`requireRefundAllowedForKind`): Campaign Wakaf, Hibah, dan Zakat hanya boleh Refund dengan tiga alasan teknis, dibandingkan sebagai seluruh teks. Usulan memakai frasa persis `dana masuk setelah Campaign ditutup` untuk Kind itu, sehingga awalan "Usulan sistem" tidak bisa ada di `reason`; penanda harus dibaca dari pemohon (pertanyaan 2).

## Pertanyaan terbuka (butuh owner sebelum membangun)

1. **Aktor sistem.** `Refund.requestedById` wajib dan berupa FK ke `User`. Tidak ada pengguna sistem di repo, dan Donation tamu tidak punya `donorId`, jadi Donor tidak bisa jadi pemohon. Pilihan:
   - **A. Skema:** `requestedById` nullable plus kolom asal (`origin`). Migrasi; slot migrasi sedang dipegang PR lain. Dampak merambat ke semua pembaca `requestedBy`.
   - **B. Baris `User` sistem lewat migrasi data** (tanpa DDL), id tetap dalam konstanta. Tetap butuh slot migrasi.
   - **C. Baris `User` sistem dibuat malas saat pertama dipakai** (tanpa migrasi, tanpa skema), email disegel lewat `contact-fields`, tanpa kata sandi. Risiko: muncul di daftar pengguna Admin dan perlu dikecualikan dari penghitungan Admin dan alur reset sandi.
   - Rekomendasi: C untuk jalan cepat, B bila owner ingin jejak yang bersih; A hanya bila owner mau `origin` sebagai kolom.
   - Konsekuensi aturan dua orang: pemohon sistem berarti Admin mana pun boleh menyetujui dan Admin lain menyelesaikan, jadi usulan sistem butuh **dua** Admin berbeda, bukan tiga. Perlu persetujuan eksplisit owner (terkait REQ-12).
2. **Penanda usulan untuk Kind terbatas.** Penanda dibaca dari pemohon (aktor sistem), bukan dari teks alasan; `/admin/refunds` menandai baris yang pemohonnya aktor sistem.
3. **Alasan untuk SUSPENDED/CANCELLED pada Kind terbatas.** Tidak ada frasa yang cocok di daftar PRD 196. Rekomendasi: pakai `dana masuk setelah Campaign ditutup` juga.

## Berkas relevan

- `src/app/api/webhooks/[provider]/route.ts` (cabang `settled.settled`, jalur Donation)
- `src/lib/money/refunds.ts` (`createRefund`, `requireRefundAllowedForKind`)
- `src/lib/money/refund-standing.ts` (`STANDING_REFUND_WHERE`)
- `src/lib/money/payment-reconciliation.ts` (`WEBHOOK_OUTCOME`)
- `src/app/admin/refunds/page.tsx` (antrean `REQUESTED`)
- `docs/adr/0021-*.md`

## Acceptance

- [ ] Donation yang settle ketika Campaign SUSPENDED, CANCELLED, COMPLETED, atau EXPIRED menghasilkan tepat satu Refund `REQUESTED` (diusulkan) senilai Gross-nya, dengan alasan yang menyebut status Campaign
- [ ] Settlement tidak berubah: Payment `PAID`, jurnal Settlement terbit, ADR 0021 utuh (Payment yang dibayar setelah EXPIRED/FAILED pada Campaign `ACTIVE` tidak dibuatkan Refund)
- [ ] Replay webhook yang sama tidak menambah usulan kedua; Payment yang sudah punya Refund berdiri tidak diusulkan lagi
- [ ] Kegagalan membuat usulan tidak melempar ke webhook, tidak membatalkan Settlement, dan meninggalkan tanda yang bisa dicari Admin
- [ ] Usulan tampil di `/admin/refunds` dan ditandai sebagai usulan sistem
- [ ] Payment sandbox dan Trip Fee tidak dibuatkan usulan oleh jalur ini
- [ ] Tes Postgres sungguhan; review independen `sonnet` diposting di PR

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C11 dijawab owner: usulan Refund kepada Admin, tidak otomatis. Untuk Trip Fee perilaku yang ada tetap (Refund otomatis, tiket 40 dan 43). `needs-info` menjadi `ready-for-agent`.

- 2026-10-16: keputusan owner (kartu keputusan, opsi "Sesuai PRD", audit REQ-03): tiket ditulis ulang di sekitar status Campaign. Premis "Payment kedaluwarsa diusulkan Refund" dihapus karena bertentangan dengan ADR 0021. Status kembali ke `needs-info` karena aktor sistem butuh keputusan owner (pertanyaan 1); desain "REQUESTED tanpa skema" sudah ditetapkan. Bagian massal PRD (Campaign ditutup) dipisah ke `.scratch/audit-2026-10-16/issues/07-refund-massal-campaign-ditutup.md`, yang tidak butuh aktor sistem.
