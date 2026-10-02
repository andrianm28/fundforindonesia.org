# 06b: Guard the public Partnership Inquiry endpoint against spam

**What to build:** `POST /api/partnership-inquiries` is public, so anyone
on the internet can write to the partnership team's inbox. Nothing in the
repo rate-limits anything, and a failed send does not undo an Inquiry, so
a flood fills the team's mailbox and the Inquiry table at once, and the
team cannot tell a real partner from noise.

**Blocked by:** 05

**Status:** awaiting-merge

- [ ] A submission from one client is bounded: repeat posts from the same
      source are refused, and the refusal is a plain refusal rather than a
      partial write
- [ ] The limit is a shared store, not process memory, so it holds across
      the replicas a deploy may run
- [ ] A legitimate partner filling the form twice is not locked out; the
      bound is on volume, not on being seen before
- [ ] The refusal says what a person can do next, in Indonesian, and does
      not leak whether a given company was already recorded
- [ ] The team is not notified for a refused submission, so spam does not
      turn into mail amplification on top of request amplification

## Comments

- 2026-09-27 (raised during review of PR #71): the endpoint is public by
  design, because a company enquiring is not a Donor and has no account.
  That makes this a real gap rather than a speculative one, and it is
  deliberately **not** fixed in #71: it stands on its own, and holding a
  green PR for it would have been the wrong trade.
- The repo has no rate-limit, captcha or turnstile pattern to copy, so this
  ticket also decides where that pattern lives. If the first implementation
  ends up specific to this route, say so in a Comment: the next public
  endpoint will want the same thing, and Donation submission is the obvious
  candidate.
- `PARTNERSHIP_TEAM_EMAIL` has no default and is loud in production, so a
  half-configured deployment already produces `mail_not_configured`. A spam
  flood makes that noise worse, which is one more reason this is worth doing
  before the first real enquiry arrives.
- 2026-10-02 (implementation): the limiter is generic, not specific to this
  route: `src/lib/rate-limit.ts` (`consumeRateLimit`, atomic upsert on
  `RateLimitBucket`) and `src/lib/client-ip.ts`. Donation submission only needs
  a new `scope`. Limits here: 10 per client and 300 overall per hour, honeypot
  field `fax_ref` (neutral name, autofill-proof) answered as a 201 no-op; fail-open if the limiter breaks; the 300 global counts only valid, non-trapped submissions. Client address is the last (trusted
  hop) `X-Forwarded-For` entry, stored only as an HMAC; assumes nginx appends
  that header, which the owner must confirm (its config is not in this repo).

- 2026-10-02: awaiting-merge. PR #161, commit be1ca61. Status sebelumnya ditulis `in-review`, label yang tidak sah; dikoreksi koordinator.

- 2026-10-02: keputusan owner: limiter tetap fail-open saat runtime, tetapi produksi tanpa `RATE_LIMIT_SECRET` maupun `NEXTAUTH_SECRET` kini gagal boot (`src/instrumentation.ts` -> `src/lib/env-check.ts`); topologi dicatat di `.env.example` (nginx tanpa CDN, `TRUSTED_PROXY_HOPS=1`); tes `TRUSTED_PROXY_HOPS=2` lewat POST ditambahkan; migrasi diganti nama menjadi `20261002200000_rate_limit_bucket` (bentrok urutan dengan PR #172). Status tetap awaiting-merge.
