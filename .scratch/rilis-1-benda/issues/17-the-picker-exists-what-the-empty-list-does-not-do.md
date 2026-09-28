# 17: The account picker is already in the PR; what the empty list does not do is not owned

**Type:** grilling

**Status:** resolved

**Blocked by:** 16 — the two dead ends below are only fixable once
`/akun/rekening` exists, and #16 is what builds it. Nothing here reopens #16's
decisions.

## Correction first: the picker is not missing

The claim that #114 is held by two blockers, the second being an absent account
picker, **is wrong, and the check that produced it was run against the wrong
tree.** The picker is in the very PR being held.

`git show pr94-rebase:src/components/campaign/CampaignPayoutPanel.tsx` — the
file exists, and it contains all of it:

- `interface BankAccountOption { id; bankCode; accountName }` (no number, no
  ciphertext),
- `PayoutRead.bankAccounts: BankAccountOption[]`,
- a `<select aria-label="Rekening tujuan">` whose first option is
  `Pilih rekening`, listing `bankCode - accountName`,
- `canRequest` gated on `data.bankAccounts.length > 0 && bankAccountId !== ''`,
- `submit()` posting `{ bankAccountId, amount, description }` to the route that
  already demands it.

The list itself is in a route that is **added** by the same branch
(`git diff --name-status origin/main pr94-rebase` shows
`A src/app/api/user/campaigns/[slug]/payouts/route.ts`), at its lines 113-117:

```ts
const bankAccounts = await prisma.bankAccount.findMany({
  where: { ownerId: userId, verifiedAt: { not: null } },
  select: { id: true, bankCode: true, accountName: true },
  orderBy: { createdAt: 'asc' },
});
```

`grep -ril bankaccount --include="*.tsx" src/` returns 0 in `origin/main`
because that is true there, and irrelevant: #114 is unmerged. The picker is the
part of #114 that reads the list, so #114 cannot be held for lacking it.

**What is actually true:** after #114 and #115 both land, the picker will
render, and it will render **empty**, forever, for every real user. Ticket 16
is what gives it rows. The blocker is one blocker, and it is 16. Below are the
three things that no ticket owns, all of which only become visible once the
list is real.

## 1. The empty state names a problem and offers no way out of it

When `data.bankAccounts.length === 0` the panel says, in full:

> Payout hanya bisa dikirim ke rekening bank yang sudah terverifikasi, dan
> belum ada rekening terverifikasi atas nama Anda.

There is no link. Not to `/akun/rekening`, not anywhere. `src/app/akun/`
contains `page.tsx`, `pengaturan/`, `kampanye-saya/` — **no `rekening/` page
exists today**, and #16 is where it is built. So a Fundraiser with no account
is told the name of the thing that is stopping them and then left. **Is a dead
end a screen at all?** A person who has never had a bank account here, and a
person whose account was rejected, read the same sentence — and only the second
group has done something wrong.

## 2. A rejected account is invisible, and #16 makes it permanent

The route filters `verifiedAt: { not: null }`. An account that was submitted and
rejected carries `verifiedAt === null`, so it never appears in the list — while
remaining in the database, in the user's own account page, and refused by
`payouts.ts` forever. That permanence is #16's decision 5 and it is accepted
there, so this is not a reopening: it is the consequence **reaching the screen**.
Today the user is told "you have no verified account" when the truth is "one of
yours was checked and failed, and no path exists to fix it." **Does the picker
say which?** It cannot currently, because the query it uses has thrown the
answer away — and that query is a deliberate, commented choice, so changing it
is a decision, not a fix.

## 3. The fourth blocker: the Volunteer Trip payout, which nobody owns

This one is a real missing UI and it is not #114's. The twin route at
`src/app/api/volunteer-trips/[slug]/payouts/route.ts:11` carries the same
requirement —

```ts
bankAccountId: z.string().min(1, 'Rekening bank harus dipilih'),
```

— and `grep -rln "volunteer-trips.*payouts" --include="*.tsx" src/` returns
**0 files**. The panel's own doc comment says it is "scoped to one Campaign's
slug". So the Trip payout has an API that demands an account and no screen that
can supply one, exactly the shape #114 was wrongly said to have. **No ticket
claims it.** #16 is the unblocker here too, so it is filed as blocked rather
than as a duplicate of #16.

For the record, the money layer is **not** part of this: `requestPayout` checks
`bankAccount.ownerId !== requestedById` and refuses (`src/lib/money/payouts.ts:149`),
so a user cannot point a Payout at someone else's account. `BankAccount.ownerId`
is a `User` (`prisma/schema.prisma`), not a Campaign — so "whose account" is
answered by the schema, not by us: it is the **requesting User's**, and both
routes agree because `refuseUnlessFundraiser` pins the session user to the
Campaign's creator.

## The encryption question, answered with what was actually checked

**Can `readBankAccountNumber` be called in a server component without leaking
ciphertext to the browser?** For the picker, the honest answer is that the
question does not arise, and calling it would *create* the risk rather than
avoid it. The picker displays `bankCode` and `accountName` — both plaintext
columns, neither sealed — and the route's `select` never touches
`accountNumberCiphertext` at all, so there is nothing on the wire to leak. Its
comment at lines 108-112 says so deliberately. **Recommendation: the picker
never decrypts.**

Three things I checked rather than assumed, and one thing I could not:

- **`readBankAccountNumber` is not in the picker's path, and should not be.**
  Adding it would put a decrypted number into a JSON response that the browser
  receives — the real leak is *plaintext on the wire*, which the current design
  avoids entirely.
- **There is no structural guard.** `grep -rn "server-only" src/` returns **0**
  files and `server-only` is not in `package.json`. Nothing stops a client
  component from importing `contact-fields.ts`. The only thing stopping it is
  that `requireFieldKeys()` reads `process.env` and **throws** in a browser
  bundle — a crash at runtime, not a refusal, and not a build error. **No
  ticket owns adding the guard.**
- **The repo's existing precedent does the thing this ticket is asking us not
  to do.** `src/app/admin/campaigns/page.tsx:87` and
  `src/app/moderasi/campaigns/[id]/page.tsx:158` both decrypt inside a server
  component and render the plaintext into JSX, which puts it in the RSC payload.
  Nobody flagged it, and it is out of scope here — but it is evidence that "we
  decrypt in server components" is currently the house style, not a considered
  position.
- **Not verified, and I am not claiming it:** I did not run the app and observe
  the RSC payload. The statement "no ciphertext is on the wire" rests on the
  `select` list, which is readable from the source. That is strong, and it is
  not a runtime proof. The masking question #12 left open is untouched: the
  correct masked number, if the owner wants one, is the last four — which is
  exactly what should *not* be sent over the wire to be masked client-side.

## Questions this ticket leaves for the owner

1. Link out of the empty state, or leave it a dead end? If a link, does the
   "rejected" case get its own sentence?
2. Should the picker's query surface rejected accounts so the Fundraiser can
   see what happened, given that no fix path exists for them?
3. Is the Volunteer Trip payout in scope for a future screen, and if so does it
   reuse this panel or need its own?
4. Is `server-only` on the contact-field modules a decision, given the current
   precedent decrypts in server components on purpose?

## Files

Documents only, like #12 and #13. No production code, no schema, no migration.
`CONTEXT.md`, `AGENTS.md`, `docs/`, `prisma/schema.prisma` and
`prd-compliance-fase-0-2` are untouched.

## Answer

Owner (Dri), 2026-09-28, in the batch grilling round
([grilling-borongan-2026-09-28.md](../grilling-borongan-2026-09-28.md)),
answered "ya semua": the recommendation stands as the decision.

(1) pasang tautan ke `/akun/rekening` di empty state sekarang, biaya rendah;
(2) query pemilih tetap `verifiedAt: {not:null}`, tapi tambah kalimat pembeda
di empty state ("belum pernah menambahkan" vs "ada yang ditolak, cek status di
halaman rekening"); (3) jadwalkan tiket implementasi terpisah untuk payout
Volunteer Trip, clone panel Campaign, setelah #114 merge.
