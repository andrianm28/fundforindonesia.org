# 47: A stored profile picture never reaches the session

**What to build:** A user who has signed in with a picture gets an
`avatar` stored, and the session carries nothing. `token.picture` stays
null, so every surface that reads the picture from the session shows a
placeholder even though the image is on the row.

**Blocked by:** None (can start immediately)

**Status:** in-review

- [x] A user with a stored `avatar` has a picture in the session, so the
      picture renders wherever the session is the source
- [x] The mapping goes one way only if it has to: `image` in, `avatar` on
      the row, and back out to whatever the session calls it. A second
      field holding the same value is not the answer
- [x] A user with no picture still gets the same placeholder as before, not
      a broken image
- [x] Signing in again with a different picture updates the stored one, and
      the session reflects the new one

## Comments

- 2026-09-27 (independent re-review of PR #89): the encryption contract
  made this visible. `getUserByEmail` and friends now return an address, so
  next-auth stops receiving a blank user — but `avatar` is never mapped back
  to the `image` field the session is built from. The picture has been
  stored all along; it just stopped arriving.

  Not a blocker, and not a regression anyone reported, which is exactly why
  it is written down: the picture was being written to the database the whole
  time and nothing surfaced it. Found by asking what else next-auth reads
  that `User` no longer has.

- Two sibling findings from the same review, neither blocking and both
  latent only:
  - `getSessionAndUser` is not wrapped, so a session read would see no
    address. Latent because the session strategy is `jwt` (ADR 0012's
    plaintext is gone, so the JWT carries the address instead). If the
    strategy ever changes to `database`, this becomes a real blank-session
    bug, and nothing currently tests for it.
  - `updateUser` passes next-auth's shape straight down, so it would throw
    `Unknown argument 'image'` if an Email credential provider were ever
    added. There is no EmailProvider today, so nothing reaches it. Worth
    closing before one is added, not after.
