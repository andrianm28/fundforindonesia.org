# 43: Fix session-mock type errors left by the assignments field

**What to build:** `tsc --noEmit` is clean again for every test file that constructs a raw `Session`/`NextAuth` mock object, without touching any of those files' actual assertions or behavior.

**Blocked by:** 7

**Status:** done (PR #184, 6e6a2ab)

- [ ] Every pre-existing test file that builds a session mock literal (`{ user: { id, role, isVerified, verificationType, ... } }`) without `assignments` gains it, matching this repo's established convention that `Session.user` fields are non-optional
- [ ] No test's runtime assertions change — these are type-only fixes; `npx vitest run` was already fully green before this ticket and must stay that way
- [ ] `src/lib/auth.test.ts`'s two `'session.user' is possibly 'undefined'` errors (lines ~97, ~108) are fixed properly — this one is a narrow, genuine gap in ticket 07's own new test file, not a pre-existing-fixture issue like the rest
- [ ] The `mockResolvedValue`/`'mock' does not exist` Prisma-client-mock-typing errors (search-filter-intersection, profile-name-persistence, api-validation) and the `RequestInit` version-mismatch errors (auth-notifications, role-management, campaigns/[slug]) are confirmed pre-existing and unrelated to `assignments` — do not fix them as part of this ticket unless they turn out to interact; they were already present before ticket 07 and are out of scope here

**Context — how this was found:** `npx tsc --noEmit` jumped from 35 (the baseline right before merging ticket 07) to 86 immediately after. Broken down precisely before filing this: 61 errors trace to `assignments: Assignment[]` becoming a required field on `Session.user` (ticket 07, Task 1) — following this codebase's own pre-existing convention that `role`/`isVerified`/`verificationType` are non-optional too, not a new pattern ticket 07 invented. The other 25 are confirmed unrelated (no file overlap with anything ticket 07 touched) and pre-existing.

Deliberately not fixed inline during ticket 07's merge: 61 errors across roughly a dozen files is a real, scoped body of work, not a one-line fix, and doing it unplanned mid-merge with no task brief and no review would be exactly the kind of scope creep this process exists to avoid. Filed here instead so it gets its own pass.

## Comments

- 2026-10-02: awaiting-merge. PR #184, commit bb12f36. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.
- 2026-10-02 (tindak lanjut code-review PR #184), bukti. Kotak tidak dicentang dan Status tidak diubah; centang saat `done`.
  - **Cast dihapus.** `(session as Session)` di `src/lib/auth.test.ts` diganti helper `assignmentsOf(session: Session | DefaultSession)`. `callbacks.session` bertipe kembali `Session | DefaultSession`, dan hanya `Session.user` yang punya `assignments`; helper menyempitkan dengan operator `in` (tanpa cast, tanpa `as any`) dan melempar bila `user`/`assignments` hilang. Asersi `toEqual` tidak berubah. `vitest run src/lib/auth.test.ts`: 14 lulus. Jumlah tsc tetap 19, jadi `ci/baselines.json` tidak diubah (sudah 19).
  - **Kenapa 19, bukan 25.** Ukuran ulang `tsc --noEmit` pada commit merge tiket 07 (`c4620ae`) = 47 (sama dengan baseline main sebelum PR ini); angka 86/61/25 di tiket tidak bisa direproduksi, jadi "25 pre-existing" adalah perkiraan, bukan hitungan. Dari 47 itu, PR ini menghapus 28 error karena literal sesi tanpa `assignments` atau tipe sesi: `api-validation.property` 4, `profile-name-persistence.property` 3, `balance/route` 2, `campaigns/[slug]/route` 6, `user/profile/route` 6, `lib/auth.test` 4 (termasuk dua `session.user` possibly undefined), `useUnreadCount` 3. Sisa 19 tidak berhubungan dengan `assignments`: 17 error tipe mock Prisma (`mockResolvedValue`/`mock` tidak ada: search-filter-intersection 12, api-validation 4, profile-name-persistence 1) dan 2 `RequestInit` (auth-notifications 1, campaigns/[slug]/route 1). Tiket menyebut tiga berkas `RequestInit` termasuk role-management; role-management tidak punya error tsc di `c4620ae` maupun sekarang, jadi 25 vs 19 tidak lebih dari selisih perkiraan itu.
  - **Cakupan literal mock.** Tidak ada error tsc yang menyebut `assignments`/`session.user` tersisa; seluruh 19 error ada di daftar di atas. Berkas tes lain yang memakai `user: {` tanpa `assignments` (mis. donations, bank-accounts, password) tidak menghasilkan error karena `getServerSession` di sana di-mock tanpa tipe `Session`, jadi tidak ada literal yang perlu ditambah.
- 2026-10-02: done. Merge ke main sebagai 6e6a2ab.
