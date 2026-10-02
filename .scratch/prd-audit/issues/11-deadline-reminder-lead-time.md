# 11: Pengingat tenggat Campaign terkirim 3 hari sebelum tenggat, PRD minta 7 hari

**Type:** task

**Status:** done (PR #164, 04001cd)

**Blocked by:** —

## Why

Ditemukan di tiket 09. PRD FFI-03 (`docs/PRD-fund-for-indonesia.md:120`):
"pengingat email saat tenggat tinggal tujuh hari". Kode:
`CAMPAIGN_DEADLINE_REMINDER_DAYS = 3` (`src/lib/reminders.ts:22`), dengan
komentar ASSUMPTION (`:16-21`) bahwa tiket 20 tidak menyebut angka. Angka itu
tebakan implementer, bukan keputusan; PRD menyebutnya. Fundraiser punya
jendela 3 hari, bukan 7, sebelum Campaign jadi Expired.

## Question

Ubah konstanta menjadi 7 (satu baris) dan sesuaikan `src/lib/reminders.test.ts`
serta teks email di `src/lib/mail/reminders.ts` bila menyebut "3 hari"? Atau
owner memang memilih 3 hari dan PRD yang direvisi? Catatan: Campaign yang
sudah dalam jendela 3-7 hari saat perubahan dirilis akan mendapat pengingat
pada sapuan pertama setelah deploy (sekali, `deadlineReminderSentAt`
mencegah ulang).

## Hasil

`CAMPAIGN_DEADLINE_REMINDER_DAYS = 7` (sesuai PRD FFI-03), komentar ASSUMPTION
diganti rujukan PRD, tes batas 5/7/7 hari+1ms dan dedupe aturan lama
ditambahkan. Teks email dan CONTEXT.md tidak menyebut jumlah hari. Dedupe
memakai `deadlineReminderSentAt`, tidak bergantung pada konstanta. Saat deploy,
Campaign Active yang tenggatnya 3-7 hari lagi dan belum diingatkan dapat
pengingat pada sapuan pertama (sekali).

## Comments

- 2026-10-02: done. Merged di PR #164 (04001cd). Status sebelumnya `in-review` (label tidak sah); dikoreksi koordinator.
