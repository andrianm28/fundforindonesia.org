# 80: M-d refund-diusulkan-untuk-dana-masuk-setelah-Campaign-ditutup

**Status:** awaiting-merge

**Blocked by:** none

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

## Desain (dibangun 2026-10-16, tanpa aktor sistem, tanpa skema)

Webhook **tidak disentuh**. Daftar kerja di `/admin/refunds`, bagian "Dana masuk setelah Campaign ditutup", berisi Payment Donation `PAID` yang `settledAt`-nya lebih baru dari waktu Campaign-nya ditutup (SUSPENDED, CANCELLED, COMPLETED, EXPIRED) dan yang tidak punya Refund berdiri (`STANDING_REFUND_WHERE`; Refund REJECTED/FAILED mengembalikan Payment ke daftar). Hanya mode yang sama (sandbox tidak muncul di mode live), bukan Donation teranonimkan, bukan Demo Campaign.

Tiap baris punya tombol "Ajukan refund": `POST /api/admin/refunds/late-settlements` (`withHiddenAssignmentCheck(ADMIN)`) memanggil `createRefund` dengan Admin yang menekan sebagai pemohon, nominal penuh Gross. Aturan tiga Admin berbeda utuh (REQ-12). Server menurunkan ulang baris di bawah kunci Campaign, jadi halaman basi tidak menggandakan; dua klik bersamaan menghasilkan satu Refund (kunci Campaign lalu Payment, dan batas kumulatif `createRefund`).

Kode: `src/lib/money/campaign-refund-proposals.ts` (`lateSettlementWorklist`, `proposeLateSettlementRefund`).

**Waktu penutupan** diambil dari `CampaignStatusChange` (baris terbaru dengan `toStatus` = status Campaign sekarang). Untuk EXPIRED, tenggat dipakai bila lebih awal dari catatan, karena kedaluwarsa dicatat malas oleh pembaca pertama. Campaign tanpa catatan (dan bukan EXPIRED dengan tenggat) tidak muncul: tanpa rekaman, menyebut sebuah Payment "setelah penutupan" adalah tebakan atas uang. Batas: hanya penutupan yang berlaku sekarang yang dikenal; dana yang masuk selama Suspension yang sudah dicabut tidak terdaftar.

**ADR 0021 utuh:** Payment yang dibayar setelah EXPIRED/FAILED pada Campaign yang masih terbuka tetap Settlement dan tidak masuk daftar.

**Alasan Refund** `dana masuk setelah Campaign ditutup`, satu dari tiga frasa PRD 196, sehingga lolos aturan Kind terbatas tanpa penanda tambahan.

## Keputusan

- 2026-10-16: opsi aktor sistem (A/B/C) **tidak diambil** demi menjaga REQ-12 (tiga Admin berbeda) dan tanpa migrasi. Usulan otomatis di webhook diganti daftar kerja yang diajukan Admin satu klik. Konsekuensi: PRD 7.2 menyebut "otomatis masuk antrean" untuk Suspended/Cancelled; yang dibangun adalah daftar kerja, bukan baris Refund yang sudah ada sebelum Admin melihatnya. Dana yang masuk tetap tidak otomatis dibekukan sampai Admin mengajukan.

## Berkas relevan

- `src/app/api/webhooks/[provider]/route.ts` (cabang `settled.settled`, jalur Donation)
- `src/lib/money/refunds.ts` (`createRefund`, `requireRefundAllowedForKind`)
- `src/lib/money/refund-standing.ts` (`STANDING_REFUND_WHERE`)
- `src/lib/money/payment-reconciliation.ts` (`WEBHOOK_OUTCOME`)
- `src/app/admin/refunds/page.tsx` (antrean `REQUESTED`)
- `docs/adr/0021-*.md`

## Acceptance

- [x] Donation yang settle setelah Campaign SUSPENDED, CANCELLED, COMPLETED, atau EXPIRED muncul di daftar kerja; satu klik membuat tepat satu Refund `REQUESTED` senilai Gross-nya
- [x] Settlement tidak berubah (webhook tidak disentuh): Payment `PAID`, jurnal Settlement terbit, ADR 0021 utuh (Payment yang dibayar setelah EXPIRED/FAILED pada Campaign `ACTIVE` tidak dibuatkan Refund)
- [x] Payment yang sudah punya Refund berdiri tidak muncul lagi; dua klik bersamaan menghasilkan satu Refund
- [x] (Tidak berlaku lagi: tidak ada kode di webhook.)
- [x] Daftar tampil di `/admin/refunds`
- [x] Payment sandbox dan Trip Fee tidak masuk daftar
- [x] Tes Postgres sungguhan
- [ ] Review independen `sonnet` diposting di PR (koordinator)

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (Track B). Bagian rencana yang terpotong tidak ditebak.

- 2026-10-04 (ronde C): C11 dijawab owner: usulan Refund kepada Admin, tidak otomatis. Untuk Trip Fee perilaku yang ada tetap (Refund otomatis, tiket 40 dan 43). `needs-info` menjadi `ready-for-agent`.

- 2026-10-16: keputusan owner (kartu keputusan, opsi "Sesuai PRD", audit REQ-03): tiket ditulis ulang di sekitar status Campaign. Premis "Payment kedaluwarsa diusulkan Refund" dihapus karena bertentangan dengan ADR 0021. Status kembali ke `needs-info` karena aktor sistem butuh keputusan owner (pertanyaan 1); desain "REQUESTED tanpa skema" sudah ditetapkan. Bagian massal PRD (Campaign ditutup) dipisah ke `.scratch/audit-2026-10-16/issues/07-refund-massal-campaign-ditutup.md`, yang tidak butuh aktor sistem.

- 2026-10-16: dibangun di cabang `claude/audit-refund-prd72` sebagai daftar kerja, tanpa aktor sistem (opsi A/B/C tidak diambil, demi REQ-12), tanpa skema, webhook tidak berubah. Status `awaiting-merge`; menjadi `done` saat merge. Tes: `src/__tests__/integration/closed-campaign-refund-proposals-real-db.test.ts`, `src/app/api/admin/refund-proposal-routes.test.ts`.
