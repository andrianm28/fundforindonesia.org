# 23: Guest Donor history claim

**What to build:** Someone who gave as a guest and later registers finds their past gifts waiting, and nobody can claim anyone else's.

**Blocked by:** 16, 18

**Status:** in-review

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
  anonymised Donation cannot match; `anonymisedAt` is additionally read
  defensively off the row (never named in a `select`/`where`), so the code
  compiles before and after. After #172 merges, `anonymisedAt: null` can be
  added to the `where` in `guest-donation-claim.ts`.

  Decisions for the owner: (1) Google sign-in does not verify the address;
  trusting Google's `email_verified` is a one-line follow-up. (2) Rate limiting
  is a 60 s per-account cooldown, as Receipt resend does; swap for
  `src/lib/rate-limit.ts` once PR #161 merges. (3) Registering with an address
  someone else uses is still allowed (unchanged); it just claims nothing.
  (4) Claimed Donations keep their `guest*` columns.
- 2026-10-02: keputusan owner (Dri): login atau registrasi lewat Google belum dianggap email terverifikasi; klaim riwayat Donation tamu hanya setelah konfirmasi tautan email; registrasi dengan email milik orang lain diizinkan tetapi tidak mengklaim apa pun. Dicatat di ADR 0022 dan CONTEXT.md.
