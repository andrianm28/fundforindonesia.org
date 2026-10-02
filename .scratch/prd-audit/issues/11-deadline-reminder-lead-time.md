# 11: Pengingat tenggat Campaign terkirim 3 hari sebelum tenggat, PRD minta 7 hari

**Type:** task

**Status:** needs-triage

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
