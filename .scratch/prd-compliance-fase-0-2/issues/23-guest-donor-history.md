# 23: Guest Donor history claim

**What to build:** Someone who gave as a guest and later registers finds their past gifts waiting, and nobody can claim anyone else's.

**Blocked by:** 16, 18

**Status:** done (PR #186, 7aed972)

- [x] History appears only after the account's email is verified by confirmation link
- [x] Matching goes through the email HMAC, never a decrypted scan
- [x] An unverified account sees nothing, however the email matches

## Comments

- 2026-10-02, builder (branch `claude/prd-23-guest-donor-history`):

  Where: `src/lib/email-verification.ts` (request and confirm a link),
  `src/lib/guest-donation-claim.ts` (the claim), `POST /api/user/email-verification`
  (signed-in, sends to the account's own address), `POST
  /api/user/email-verification/confirm` (token in body), page
  `/akun/verifikasi-email`, a prompt on Donasi Saya, and `GET
  /api/donations/mine` now claims first and returns `emailVerified`. Migration
  `20261002150000_email_verification` adds `User.emailVerifiedAt` and
  `EmailVerificationToken` (SHA-256 of the token only).

  Compatible with PR #172 (ticket 36) in either merge order: the claim matches
  `guestEmailHmac` + key id, and #172 clears that HMAC on anonymisation, so an
  anonymised Donation cannot match; `anonymisedAt` is not referenced at all
  (see the follow-up below).

  Decisions for the owner: (1) Google sign-in does not verify the address;
  trusting Google's `email_verified` is a one-line follow-up. (2) Rate limiting
  is a 60 s per-account cooldown, as Receipt resend does; swap for
  `src/lib/rate-limit.ts` once PR #161 merges. (3) Registering with an address
  someone else uses is still allowed (unchanged); it just claims nothing.
  (4) Claimed Donations keep their `guest*` columns.
- 2026-10-02: keputusan owner (Dri): login atau registrasi lewat Google belum dianggap email terverifikasi; klaim riwayat Donation tamu hanya setelah konfirmasi tautan email; registrasi dengan email milik orang lain diizinkan tetapi tidak mengklaim apa pun. Dicatat di ADR 0022 dan CONTEXT.md.

- 2026-10-02: awaiting-merge. PR #186, commit aad00d2. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.

- 2026-10-02, builder (tindak lanjut code-review PR #186): `claimGuestDonations` kini memfilter `donorId: null`, `guestEmailHmac`, dan `guestEmailHmacKeyId` pada baca dan tulis; `isAnonymised` dihapus (tidak pernah efektif karena `select: { id: true }`). PR ini tidak merujuk `Donation.anonymisedAt`: Donation teranonimkan tidak bisa cocok karena #172 mengosongkan HMAC (dites di unit dan Postgres sungguhan). Rotasi kunci gagal-aman: donasi tamu dengan key id lama tidak diklaim akun dengan key id baru (ADR 0020, dites).
  **Tindak lanjut wajib setelah #172 merge (SELESAI 2026-10-02, branch claude/followups-anonymisation-2026-10-02):** tambahkan `anonymisedAt: null` ke `where` pada `findMany` dan `updateMany` di `src/lib/guest-donation-claim.ts`, dan tambahkan kasus tes Postgres sungguhan untuk Donation dengan `anonymisedAt` terisi. Tes Postgres yang ada sudah gagal bila Donation ber-HMAC kosong ikut diklaim.
- 2026-10-02: done. Merge ke main sebagai 7aed972.
- 2026-10-02: tindak lanjut di atas selesai. `findMany` dan `updateMany` di `claimGuestDonations` kini memfilter `anonymisedAt: null`; tes unit dan tes Postgres sungguhan (Donation ber-`anonymisedAt` dengan HMAC masih cocok tidak diklaim) ditambahkan.
