# 89: M-a payout-reveal-account-number

**Status:** done (PR #232, e549020)

**Blocked by:** none (tiket). C6 dijawab owner 2026-10-04 (hanya Admin penyelesai, tercatat di tabel audit); acceptance final. Memakai "slot skema" Gelombang 1.

**Ukuran:** S

**Catatan:** Skema: menambah tabel audit reveal, jadi menyentuh `prisma/schema.prisma`/migrasi. Satu PR skema pada satu waktu; timestamp migrasi dibagi koordinator. Review uang/keamanan: wajib review independen `sonnet` dengan bukti diposting di PR. Pra-M1 dan prasyarat gladi tertutup bersama A-1 (88), lihat C1.

**Keputusan (2026-10-04, ronde C):** C6 dijawab owner sesuai rekomendasi: hanya Admin penyelesai yang boleh membuka nomor rekening, tercatat di tabel audit. Acceptance di bawah final.

## Latar

Admin tidak bisa melihat nomor rekening tujuan Payout: `src/app/admin/payouts/[id]/page.tsx:70` hanya memilih `bankCode` dan `accountName`, dan tes `src/app/admin/payouts/[id]/page.test.tsx:104` mengunci hal itu (`accountNumberCiphertext` tidak boleh dipilih). Karena Payout dijalankan manual di dashboard penyedia (ADR 0006), Payout mustahil tanpa psql.

Tiket ini **membuka ulang premis** `12-decrypting-a-bank-account-at-payout.md`, yang menjawab bahwa nomor tak pernah dibaca saat payout dan menutup pertanyaan reveal sebagai "tidak berlaku". Premis itu salah untuk transfer manual: Admin harus mengetik nomor penuh. Jawaban 12 perlu diamandemen bertanggal, bukan ditulis ulang. Catatan ADR 0012: ciphertext teracak, jadi pembacaan tidak bisa dicari belakangan; tabel audit reveal justru menutup celah itu.

## Berkas relevan

- `src/app/admin/payouts/[id]/page.tsx` (baris 70: pemilihan `bankAccount`)
- `src/app/admin/payouts/[id]/page.test.tsx` (baris 104: tes yang melarang `accountNumberCiphertext`; harus diperbaiki)
- `src/lib/contact-fields.ts` (`readBankAccountNumber`, kini tanpa pemanggil produksi)
- `src/lib/money/payouts.ts`
- `prisma/schema.prisma` (tabel audit reveal baru; komentar `accountNumberCiphertext`)
- `.scratch/rilis-1-benda/issues/12-decrypting-a-bank-account-at-payout.md`

## Acceptance

- [x] Nomor penuh hanya terlihat oleh Admin penyelesai, hanya saat Payout `APPROVED`, dan tidak oleh requester maupun approver Payout itu
- [x] Tiap pembukaan menulis baris di tabel audit reveal (siapa, Payout mana, kapan); migrasi mengikuti aturan satu PR skema
- [x] Pembukaan lewat aksi eksplisit di server; nomor tidak ikut dalam payload halaman default dan tidak dicatat di log
- [x] Tes `page.test.tsx:104` diperbaiki sesuai perilaku baru; tes menolak requester, approver, dan status selain APPROVED
- [x] Komentar `accountNumberCiphertext` di skema dan jawaban `12` diamandemen bertanggal
- [x] Review independen `sonnet` (uang/keamanan) diposting di PR

## Comments

- 2026-10-04: ditulis dari `.scratch/percepatan-full-rilis/plan.md` (baris Pra-M1 M-a, dipulihkan dari relay kedua). C6 masih menunggu jawaban owner.

- 2026-10-04 (ronde C): C6 dijawab owner, sesuai rekomendasi dan sesuai acceptance di atas: hanya Admin penyelesai, tercatat di tabel audit. Tidak ada perubahan acceptance; status tetap `ready-for-agent`.
- 2026-10-10 (koordinator): di-merge ke `main` lewat PR #232 (e549020).
