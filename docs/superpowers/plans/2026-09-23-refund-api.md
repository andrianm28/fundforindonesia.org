# Minimal Refund API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Admin can create a Refund for a Payment a Donor was overcharged, and a different Admin can approve it, moving the refunded amount into a Frozen Balance immediately and posting the PRD's gross-recognition settlement at approval — generalized over a Campaign-or-Trip subject from day one so ticket 05 (Trip Fee refunds) can call the same core untouched.

**Architecture:** New `src/lib/money/refunds.ts` exports `createRefund`/`approveRefund`, mirroring `src/lib/money/payouts.ts`'s two-function, two-transaction shape (request in the caller's own `$transaction`, approve in its own). `createRefund` locks the `Payment` row (the cumulative-refund-cap's contended resource), validates the Payment belongs to the given subject and isn't a demo Campaign, checks the requested amount against what's still refundable (Gross minus every prior non-rejected/failed Refund), creates the `Refund` row, and immediately posts a 2-leg freeze (`refundRequestedLegs`, new in `lib/money/ledger.ts`) moving `amount` out of `ESCROW_HOLD` or the withdrawable balance into the new `FROZEN_BALANCE` account. `approveRefund` locks the subject's row (`Campaign`/`VolunteerTrip`, same discipline as `approvePayout`), re-derives the settlement source fresh (escrow may have matured since the request), computes the proportional Platform Fee (always 0 — nothing in this codebase charges one yet) and Provider Fee portions per ADR 0007, checks whether the subject's pool has gone negative from the freeze and folds any such shortfall into `REFUND_COST` too, claims the row via a status-predicated `updateMany`, then posts the 2-to-4-leg settlement (`refundApprovedLegs`, new) debiting `FROZEN_BALANCE`/`PLATFORM_FEE`/`REFUND_COST` (three debits summing to exactly `amount`, the spec's own explicit invariant) and crediting `REFUND_CLEARING` for the full Gross. Two new Admin-only routes (`POST .../refunds`, `PATCH .../refunds/[id]/approve`) mirror the Campaign payout routes' structure exactly, minus ownership gating (Refund is Admin-create + Admin-approve on both ends, PRD §7.2).

**Deviations from the spec's literal text, made here and flagged for review, not silently:**
1. The spec's Schema section says "no other schema change" beyond `RefundStatus`/`LedgerAccount`, listing `Refund.paymentId/amount/reason/status/approvedById/providerRef` as sufficient — but User Story 4 (self-approval must be blocked) is impossible to implement without knowing who *requested* a Refund, and no existing field carries that. `Payout` already solved this identically with `requestedById`/`requestedBy` (`"PayoutRequester"` relation). Task 1 adds the same pair to `Refund` (`"RefundRequester"`), which is the only schema change beyond what the spec named.
2. The spec calls `RefundStatus`'s target "the PRD's full six-state set" but then lists seven names (`REQUESTED, AWAITING_DONOR_DETAILS, APPROVED, PROCESSING, COMPLETED, REJECTED, FAILED`). The explicit list is the concrete, unambiguous data; the adjective is prose. Task 1 implements all seven named values.
3. The settlement math ("debits FROZEN_BALANCE for the refunded amount... debits PLATFORM_FEE... debits REFUND_COST... The three debits sum to exactly amount") is only internally consistent if "for the refunded amount" is read as shorthand, not as `amount` literally — three debits that are each independently `amount`-sized obviously cannot also sum to `amount` when the fee portions are nonzero. Task 2's `refundApprovedLegs` implements the literal, load-bearing final sentence: `FROZEN_BALANCE debit = amount - platformFeePortion - providerFeePortion - shortfall`, `REFUND_COST debit = providerFeePortion + shortfall`, `PLATFORM_FEE debit = platformFeePortion`, `REFUND_CLEARING credit = amount`. Documented in full in `refundApprovedLegs`'s own doc comment.

**Tech Stack:** Next.js App Router, Prisma 7, Postgres, Vitest, Zod, TypeScript.

**Spec:** `.scratch/refund-api/spec.md`

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    ~/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-23-refund-api.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief
    ~/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-23-refund-api.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- `RefundStatus` expands from its current four values (`REQUESTED`, `PROCESSING`, `COMPLETED`, `REJECTED`) to `REQUESTED`, `AWAITING_DONOR_DETAILS`, `APPROVED`, `PROCESSING`, `COMPLETED`, `REJECTED`, `FAILED`. This ticket's own code only ever produces `REQUESTED` and `APPROVED`.
- `LedgerAccount` gains `FROZEN_BALANCE` (subject-scoped, funds move here immediately when a Refund is created) and `REFUND_COST` (platform-level, the platform's absorption of whatever a refund's source didn't cover).
- No other schema change beyond `Refund.requestedById`/`requestedBy` (see the Architecture deviation above — required for the self-approval check the spec itself demands but doesn't wire a field for).
- `createRefund(tx, { subject, paymentId, amount, reason, requestedById })`: validates the Payment exists, belongs to the given subject (a Campaign-linked Payment for a `{type:'campaign'}` subject, Trip-linked for `{type:'trip'}`), and is not on a demo Campaign. Computes the Payment's remaining refundable amount as its Gross minus the sum of every prior Refund against it whose status is not `REJECTED` or `FAILED` (a deliberately conservative sum: `REQUESTED` refunds count too, since their funds are already frozen). Refuses if the requested `amount` exceeds what's still refundable. On success: creates the `Refund` row at `REQUESTED`, and immediately posts a two-leg journal entry in the same transaction: `DEBIT` the subject's `ESCROW_HOLD` (if the Payment's escrow hasn't matured yet) or its withdrawable `CAMPAIGN_BALANCE`/`TRIP_BALANCE` (if it has), `CREDIT FROZEN_BALANCE`, both for the requested `amount`. This is the PRD's "seketika" (immediate) requirement at `Requested`, and the one deliberate structural divergence from the `requestPayout` mirror.
- `approveRefund(prisma, { refundId, approvedById })`: mirrors `approvePayout` closely — loads the Refund, refuses if `approvedById === requestedById`, refuses if status is not `REQUESTED`, locks the subject's row (`Campaign` or `VolunteerTrip`, `FOR UPDATE`) before recomputing its current pool balance, and claims the row via a status-predicated `updateMany` (`REQUESTED` → `APPROVED`) before posting anything. On success, posts the gross-recognition posting: computes the fee split proportional to `amount / payment.amount`, rounded up, with the combined Platform Fee and Provider Fee portions never exceeding `amount`; debits `FROZEN_BALANCE`, `PLATFORM_FEE`, and `REFUND_COST` (three debits summing to exactly `amount`), and credits `REFUND_CLEARING` for the full `amount`.
- `refundLegs` (`src/lib/money/ledger.ts`) is replaced by two new leg builders: `refundRequestedLegs` (the immediate 2-leg freeze) and `refundApprovedLegs` (the settlement, up to 4 legs). Nothing in this codebase calls the old `refundLegs` — it is deleted, not deprecated.
- **Platform Fee is currently never charged anywhere in this codebase** — no `Payment`/`Campaign` field stores a platform fee amount or percentage, no leg-builder credits `PLATFORM_FEE`. The Platform Fee debit leg in `approveRefund`'s posting is real, forward-compatible code, hardcoded to `0` today because there is no field to multiply — not a bug to chase down.
- Routes: `POST /api/campaigns/[slug]/refunds` (body `{ paymentId, amount, reason }`, validates `paymentId` names a Payment whose Donation belongs to the Campaign named by `slug`, calls `createRefund` with a `{type:'campaign', campaignId}` subject inside a `prisma.$transaction`) and `PATCH /api/campaigns/[slug]/refunds/[id]/approve` (no body beyond the acting Admin's identity, calls `approveRefund`). Both gated `withAssignmentCheck(Assignment.ADMIN, ...)`, not ownership. No Trip-side HTTP route in this ticket.
- Out of scope, do not build: the donor-facing `AwaitingDonorDetails` flow (signed email link, bank account collection, Verifier review); the `PROCESSING` → `COMPLETED` transition and its ledger account; `FAILED` and its recovery path; any reject/cancel action (no route moves a `REQUESTED` Refund to `REJECTED` — a Refund created and abandoned has no route in this ticket to release its freeze); per-Kind refund limits and Suspension-triggered redirection; the three donor-facing notification emails and the Fundraiser notification; Suspension/Cancelled-Campaign/auto-proposed triggers as Refund sources — only the "Admin creates directly for a known Payment" trigger is built; any Volunteer Trip-side route or UI; any UI at all.
- All amounts are integer rupiah. Never introduce a float into a money path — every division for the proportional fee split is followed immediately by `Math.ceil`.
- The ledger is append-only: rows are added, never updated or deleted.

## Review Focus

- A partial refund whose proportional Platform Fee + Provider Fee portions, after rounding up, could combined exceed the refunded `amount` if not capped — a reasonable admin expects the platform to never claim more in fees than the refund itself. Pinned in Task 2.
- Two concurrent `createRefund` calls against the *same* Payment both trying to push its cumulative refunded total past its Gross — the Payment row lock must serialize this, not let both read the same "remaining refundable" figure and both pass. Pinned in Task 2.
- Approving a Refund whose status is already `APPROVED`, `REJECTED`, or `FAILED` must produce a distinct, non-silent error (User Story 13), never a no-op that leaves an Admin thinking nothing happened when in fact nothing should. Pinned in Task 2.
- The `PATCH .../refunds/[id]/approve` route hit with a Refund id that belongs to a *different* Campaign than the URL's `slug` must 404, never approve a Refund across Campaign boundaries. Pinned in Task 3.
- The `POST .../refunds` route hit with a `paymentId` whose Donation belongs to a *different* Campaign than the URL's `slug` must 404, never create a cross-Campaign Refund. Pinned in Task 3.

---

### Task 1: Schema — expand `RefundStatus`, add `FROZEN_BALANCE`/`REFUND_COST`, add `Refund.requestedById`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260923120000_add_refund_ledger_accounts/migration.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the 7-value `RefundStatus` enum, the 10-value `LedgerAccount` enum (adds `FROZEN_BALANCE`, `REFUND_COST`), and `Refund.requestedById: string` / `Refund.requestedBy: User` — all consumed by Task 2's `refunds.ts` and `ledger.ts` changes.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `prisma/schema.prisma` dan SQL migrasi di `prisma/migrations/`, dibaca sebagai teks, plus `npx prisma generate` dan `npx tsc --noEmit`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: kedua enum bertambah dengan nilai yang tepat, `Refund.requestedById` menjadi kolom wajib dengan relasi `"RefundRequester"` yang benar, dan migrasi tidak menyentuh baris data yang sudah ada (tabel `Refund` kosong di setiap lingkungan nyata, dikonfirmasi lewat `git log`/grep sebelum rencana ini ditulis — tidak ada kode yang pernah menulis ke tabel ini). Task ini tidak punya permukaan HTTP; regresinya adalah full suite yang tetap hijau.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Replace the `RefundStatus` enum (currently 4 values) with:

```prisma
enum RefundStatus {
  REQUESTED
  AWAITING_DONOR_DETAILS
  APPROVED
  PROCESSING
  COMPLETED
  REJECTED
  FAILED
}
```

Replace the `LedgerAccount` enum with (adds `FROZEN_BALANCE` after `TRIP_BALANCE`, `REFUND_COST` after `REFUND_CLEARING`):

```prisma
enum LedgerAccount {
  // Named accounts rather than free strings, so a typo cannot silently create
  // a new account that never balances.
  ESCROW_HOLD // settled at the provider, still inside the dispute window
  CAMPAIGN_BALANCE // owed to a specific campaign, withdrawable now
  TRIP_BALANCE
  /// Money moved out of ESCROW_HOLD or the withdrawable balance the moment a
  /// Refund is created -- no longer visible as available, no longer eligible
  /// for a Payout, remaining the Donor's right until the (out-of-scope for
  /// this ticket) COMPLETED transition. See CONTEXT.md's "Frozen Balance".
  FROZEN_BALANCE
  PLATFORM_FEE // retained by the platform
  PROVIDER_FEE // retained by the payment provider
  GATEWAY_CLEARING // money at the provider, not yet settled to us
  PAYOUT_CLEARING // money instructed out, not yet confirmed
  REFUND_CLEARING
  /// The platform's absorption of whatever a Refund's source didn't cover --
  /// the unrecoverable Provider Fee on every Gross refund (ADR 0007), and,
  /// when the subject's pool has gone negative, the uncovered shortfall too.
  REFUND_COST
}
```

Replace the `Refund` model with (adds `requestedById`/`requestedBy` before `approvedById`, mirroring `Payout`'s identical pair):

```prisma
model Refund {
  id            String       @id @default(cuid())
  paymentId     String
  payment       Payment      @relation(fields: [paymentId], references: [id])
  /// Partial refunds are allowed, so this is not necessarily the full payment.
  amount        Int
  reason        String
  status        RefundStatus @default(REQUESTED)
  requestedById String
  requestedBy   User         @relation("RefundRequester", fields: [requestedById], references: [id])
  /// Who approved it. Refunds move money back out, so they are attributable.
  approvedById  String?
  approvedBy    User?        @relation("RefundApprover", fields: [approvedById], references: [id])
  providerRef   String?      @unique
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  ledgerEntries LedgerEntry[]

  @@index([status])
  @@index([paymentId])
}
```

Do not touch any other model or enum.

- [ ] **Step 2: Write the migration by hand**

There is no live database in this environment (`npx prisma migrate status` fails with "the datasource.url property is required" — no `DATABASE_URL` is set anywhere), so `npx prisma migrate dev` cannot run. Write the SQL by hand, following this repo's own precedent for enum additions (`prisma/migrations/20260922152000_generalize_money_layer_subject/migration.sql`, which does the same `ALTER TYPE ... ADD VALUE` with no `BEFORE`/`AFTER` positioning).

Create `prisma/migrations/20260923120000_add_refund_ledger_accounts/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'AWAITING_DONOR_DETAILS';
ALTER TYPE "RefundStatus" ADD VALUE 'APPROVED';
ALTER TYPE "RefundStatus" ADD VALUE 'FAILED';

-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'FROZEN_BALANCE';
ALTER TYPE "LedgerAccount" ADD VALUE 'REFUND_COST';

-- AlterTable
-- Refund has never had a row written to it anywhere in this codebase (this
-- ticket's own Problem Statement: "Refund exists only as a schema model.
-- Nothing in this codebase creates, approves, or completes one") -- safe to
-- add NOT NULL with no backfill in any real environment.
ALTER TABLE "Refund" ADD COLUMN "requestedById" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the client and typecheck**

```bash
npx prisma generate
npx tsc --noEmit 2>&1 | grep -iE "refund|ledgeraccount" || echo "no type errors naming Refund or LedgerAccount"
```

Expected: `no type errors naming Refund or LedgerAccount`. This repo has a pre-existing backlog of unrelated type errors; only errors naming what this task touched matter here.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS, 130 files, 1344 tests, 0 failures — nothing reads `FROZEN_BALANCE`/`REFUND_COST`/`requestedById` yet, so nothing else may change behavior.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260923120000_add_refund_ledger_accounts
git commit -m "feat: expand RefundStatus, add FROZEN_BALANCE/REFUND_COST, add Refund.requestedById

RefundStatus grows from 4 to 7 values (AWAITING_DONOR_DETAILS, APPROVED,
FAILED added) per the Refund API spec's full PRD state set. LedgerAccount
gains FROZEN_BALANCE (subject-scoped, where a Refund's funds go the moment
it's created) and REFUND_COST (the platform's absorption of what a
refund's source didn't cover, per ADR 0007). Refund also gains
requestedById/requestedBy, mirroring Payout's identical pair -- not
called out by name in the spec's own schema section, but required for
the self-approval check the spec's own Implementation Decisions demand
and no existing field could satisfy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Money layer — `refundRequestedLegs`/`refundApprovedLegs` (`ledger.ts`) and `createRefund`/`approveRefund` (new `refunds.ts`)

**Files:**
- Modify: `src/lib/money/ledger.ts`
- Modify: `src/lib/money/ledger.test.ts`
- Create: `src/lib/money/refunds.ts`
- Create: `src/lib/money/refunds.test.ts`

**Interfaces:**
- Consumes: `LedgerSubject`, `postTransaction`, `campaignBalance`, `tripBalance`, `escrowBalance`, `tripEscrowBalance` (all existing, `./ledger`); `DemoCampaignError` (existing, `./payouts` — reused directly, not redefined, per the spec's explicit "mirrors requestPayout's DemoCampaignError").
- Produces: `refundRequestedLegs(params: { subject: LedgerSubject; amount: number; source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE' }): LedgerLeg[]` and `refundApprovedLegs(params: { subject: LedgerSubject; amount: number; platformFeePortion: number; providerFeePortion: number; shortfall: number }): LedgerLeg[]` (both `./ledger`, consumed by `refunds.ts` in this same task). `createRefund(tx: Prisma.TransactionClient, params: { subject: LedgerSubject; paymentId: string; amount: number; reason: string; requestedById: string }): Promise<Refund>` and `approveRefund(prisma: PrismaClient, params: { refundId: string; approvedById: string }): Promise<Refund>` (`./refunds`), consumed by Task 3's routes. Error classes exported from `./refunds`: `PaymentNotFoundError`, `PaymentSubjectMismatchError`, `RefundExceedsRemainingError`, `RefundNotFoundError`, `SelfApprovalError`, `InvalidRefundStatusError`, plus `DemoCampaignError` re-exported from `./payouts`.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah pemanggilan langsung terhadap `createRefund` dan `approveRefund` (`src/lib/money/refunds.test.ts`, seam baru), dengan fake Prisma transaction client, mirroring `src/lib/money/payouts.test.ts`'s own approach. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: sumber `ESCROW_HOLD` vs `CAMPAIGN_BALANCE`/`TRIP_BALANCE` bergantung pada `escrowReleasedAt`, subject Campaign dan subject Trip untuk kedua fungsi, `DemoCampaignError` hanya untuk subject Campaign, Refund sebelumnya yang belum `REJECTED`/`FAILED` mengurangi sisa yang bisa direfund, `RefundExceedsRemainingError` saat jumlah melebihi sisa, pembekuan dana dua-leg yang benar pada `createRefund`, pemisahan fee proporsional yang dibulatkan ke atas pada `approveRefund` (termasuk kasus partial refund), shortfall yang jatuh ke `REFUND_COST` saat pool subject negatif, `providerFee` nol, `SelfApprovalError`, `InvalidRefundStatusError` untuk status selain `REQUESTED`, race persetujuan bersamaan (hanya satu yang menang), `PaymentNotFoundError`, `PaymentSubjectMismatchError`, `RefundNotFoundError`, dan regresi cross-subject-leakage (refund Trip tidak pernah mendebit `CAMPAIGN_BALANCE`, dan sebaliknya). Helper internal (`refundRequestedLegs`, `refundApprovedLegs`, meskipun diekspor dari `ledger.ts`) diuji secara tidak langsung lewat seam `refunds.test.ts` ini, tidak pernah langsung dengan tes baru di `ledger.test.ts` -- tes LANGSUNG yang sudah ada terhadap `refundLegs` (fungsi lama yang diganti) dihapus di Step 1 di bawah, dan tes invariant properti `ledger.test.ts` yang tersisa diperbarui untuk memakai builder baru tanpa menguji perilaku bisnis spesifiknya. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Update `ledger.ts` and `ledger.test.ts` — replace `refundLegs`**

In `src/lib/money/ledger.ts`, add `'FROZEN_BALANCE'` to `SUBJECT_SCOPED`:

```typescript
const SUBJECT_SCOPED: ReadonlySet<string> = new Set<string>([
  'ESCROW_HOLD',
  'CAMPAIGN_BALANCE',
  'TRIP_BALANCE',
  'FROZEN_BALANCE',
]);
```

Delete the entire existing `refundLegs` function (its doc comment and body) and replace it with:

```typescript
/**
 * The immediate "seketika" freeze a Refund creates, moving money out of
 * general circulation the moment an Admin creates it -- not later at
 * approval -- so a Campaign or Trip cannot spend money that is already
 * earmarked for return (e.g. by requesting a Payout against it) while the
 * Refund is still pending.
 *
 *   DEBIT  <source>        amount   out of general circulation
 *   CREDIT FROZEN_BALANCE  amount   earmarked, not withdrawable, not payable out
 *
 * `source` is ESCROW_HOLD when the Payment's escrow hasn't matured yet, or
 * the subject's withdrawable balance account when it has -- the same
 * either/or `createRefund` (./refunds.ts) uses to pick it, read directly off
 * Payment.escrowReleasedAt. This does NOT check whether `source` actually
 * holds `amount`: both accounts are pooled across every Payment the subject
 * has ever received, and a single Payment's own Gross can be larger than
 * what it alone contributed net -- the pool, not this one Payment, is what
 * has to cover it. approveRefund is what actually verifies the pool can,
 * under a lock, at settlement (refundApprovedLegs below).
 */
export function refundRequestedLegs(params: {
  subject: LedgerSubject;
  amount: number;
  source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE';
}): LedgerLeg[] {
  const { subject, amount, source } = params;
  return [
    { account: source, direction: 'DEBIT', amount, ...subjectFk(subject) },
    { account: 'FROZEN_BALANCE', direction: 'CREDIT', amount, ...subjectFk(subject) },
  ];
}

/**
 * The PRD's gross-recognition posting when a Refund is approved. Closes out
 * FROZEN_BALANCE (opened by refundRequestedLegs above) and recognizes, as
 * separate lines, exactly how the refunded Gross splits between what the
 * subject's own frozen funds cover and what the platform absorbs.
 *
 *   DEBIT  FROZEN_BALANCE  amount - platformFeePortion - providerFeePortion - shortfall
 *   DEBIT  PLATFORM_FEE    platformFeePortion   (omitted when zero)
 *   DEBIT  REFUND_COST     providerFeePortion + shortfall   (omitted when zero)
 *   CREDIT REFUND_CLEARING amount
 *
 * The three debits sum to exactly `amount` -- this is the literal, load-
 * bearing constraint the spec states explicitly, and it is what makes
 * "debits FROZEN_BALANCE for the refunded amount" in the spec's own prose
 * necessarily a loose paraphrase rather than a literal `amount`: three
 * legs that were each independently `amount`-sized could never also sum to
 * `amount` once a fee portion is nonzero.
 *
 * `platformFeePortion` and `providerFeePortion` are the proportional shares
 * of Gross being refunded (amount / payment.amount), rounded up, computed
 * by the caller (./refunds.ts) -- never here, since this function only
 * assembles legs from numbers it's given, matching every other builder in
 * this file. `shortfall` is additional platform absorption for the case
 * where the subject's pool, recomputed under lock at settlement, has gone
 * negative from the freeze debit (a Campaign that already spent most of its
 * balance via Payout before this Refund's freeze landed) -- it is added
 * onto REFUND_COST's debit, and subtracted from FROZEN_BALANCE's, so the
 * three-debits-sum-to-amount invariant holds regardless of whether a
 * shortfall exists.
 */
export function refundApprovedLegs(params: {
  subject: LedgerSubject;
  amount: number;
  platformFeePortion: number;
  providerFeePortion: number;
  shortfall: number;
}): LedgerLeg[] {
  const { subject, amount, platformFeePortion, providerFeePortion, shortfall } = params;
  const combinedFeePortion = platformFeePortion + providerFeePortion;
  if (combinedFeePortion > amount) {
    throw new InvalidLedgerLegError(
      `Combined Platform Fee (${platformFeePortion}) and Provider Fee (${providerFeePortion}) portions ` +
        `exceed the refunded amount ${amount} -- refusing to post a settlement that would debit FROZEN_BALANCE negative.`,
    );
  }
  const frozenBalanceDebit = amount - combinedFeePortion - shortfall;
  const refundCostDebit = providerFeePortion + shortfall;

  const legs: LedgerLeg[] = [{ account: 'REFUND_CLEARING', direction: 'CREDIT', amount }];
  if (frozenBalanceDebit > 0) {
    legs.push({ account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: frozenBalanceDebit, ...subjectFk(subject) });
  }
  if (platformFeePortion > 0) {
    legs.push({ account: 'PLATFORM_FEE', direction: 'DEBIT', amount: platformFeePortion });
  }
  if (refundCostDebit > 0) {
    legs.push({ account: 'REFUND_COST', direction: 'DEBIT', amount: refundCostDebit });
  }
  return legs;
}
```

In `src/lib/money/ledger.test.ts`:

Update the import block to drop `refundLegs` and add the two new builders:

```typescript
import {
  postTransaction,
  campaignBalance,
  escrowBalance,
  tripBalance,
  tripEscrowBalance,
  findUnbalancedTransactions,
  paymentSettledLegs,
  escrowReleaseLegs,
  refundRequestedLegs,
  refundApprovedLegs,
  payoutInstructedLegs,
  UnbalancedTransactionError,
  InvalidLedgerLegError,
  type LedgerLeg,
  type LedgerSubject,
} from './ledger';
```

Delete the entire `describe('refundLegs', ...)` block (the four tests: "debits escrow when refunding inside the hold window", "debits the withdrawable balance when refunding after release", "rejects a refund larger than what the payment actually credited", "allows a refund of exactly what was credited") — these test the OLD net-capped `refundLegs`, which no longer exists in this shape; the new builders' own business rules are covered by `refunds.test.ts`'s seam, not here.

Delete the entire `describe('refundLegs with a trip subject', ...)` block and the entire `describe('refundLegs subject/source mismatch', ...)` block — same reason.

In `describe('ledger invariants (property-based)', ...)`, update the first test (`'every builder produces a transaction that balances, for any amount, for both subject types'`) to use the new builders instead of `refundLegs`:

```typescript
  it('every builder produces a transaction that balances, for any amount, for both subject types', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.constantFrom<'campaign' | 'trip'>('campaign', 'trip'),
        (gross, feeRaw, shortfallRaw, subjectType) => {
          const fee = Math.min(feeRaw, gross);
          const shortfall = Math.min(shortfallRaw, gross - fee);
          const subject: LedgerSubject =
            subjectType === 'campaign'
              ? { type: 'campaign', campaignId: 'c1' }
              : { type: 'trip', tripId: 't1' };
          const balanceAccount = subjectType === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE';
          for (const legs of [
            paymentSettledLegs({ subject, grossAmount: gross, providerFee: fee }),
            escrowReleaseLegs({ subject, amount: gross }),
            refundRequestedLegs({ subject, amount: gross, source: 'ESCROW_HOLD' }),
            refundRequestedLegs({ subject, amount: gross, source: balanceAccount }),
            refundApprovedLegs({ subject, amount: gross, platformFeePortion: 0, providerFeePortion: fee, shortfall }),
            payoutInstructedLegs({ subject, amount: gross }),
          ]) {
            const d = legs.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amount, 0);
            const c = legs.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amount, 0);
            expect(d).toBe(c);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
```

In the same `describe`, update `'the full lifecycle lands on the arithmetic everyone expects'` to use the new two-phase shape:

```typescript
  it('the full lifecycle lands on the arithmetic everyone expects', async () => {
    const tx = makeTx();
    // Rp 500.000 donated, Rp 15.000 kept by the provider.
    await postTransaction(tx as never, paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 500_000, providerFee: 15_000 }));
    // Rp 100.000 refunded while still held (well within the 485.000 net credited) --
    // frozen first, then settled with its proportional provider-fee share.
    await postTransaction(
      tx as never,
      refundRequestedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 100_000, source: 'ESCROW_HOLD' }),
    );
    await postTransaction(
      tx as never,
      refundApprovedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 100_000, platformFeePortion: 0, providerFeePortion: 3_000, shortfall: 0 }),
    );
    // The rest matures.
    await postTransaction(tx as never, escrowReleaseLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 385_000 }));
    // Rp 200.000 paid out.
    await postTransaction(tx as never, payoutInstructedLegs({ subject: { type: 'campaign', campaignId: 'c1' }, amount: 200_000 }));

    expect(await escrowBalance(tx as never, 'c1')).toBe(0);
    expect(await campaignBalance(tx as never, 'c1')).toBe(385_000 - 200_000);
    expect(await findUnbalancedTransactions(tx as never)).toEqual([]);
  });
```

(The escrow debit of 100_000 at freeze time plus the 385_000 release leaves ESCROW_HOLD at 0 exactly as before; FROZEN_BALANCE and REFUND_COST are new accounts this lifecycle test doesn't assert on directly — `refunds.test.ts` covers their exact figures.)

Run `npx vitest run src/lib/money/ledger.test.ts` — expected PASS, no reference to `refundLegs` remains anywhere in the file (`grep -n refundLegs src/lib/money/ledger.test.ts` should print nothing except `refundRequestedLegs`/`refundApprovedLegs` matches).

- [ ] **Step 2: Write the failing tests for `createRefund`/`approveRefund`**

```typescript
// src/lib/money/refunds.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  createRefund,
  approveRefund,
  DemoCampaignError,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
  RefundNotFoundError,
  SelfApprovalError,
  InvalidRefundStatusError,
} from './refunds';

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    amount: 100_000,
    providerFee: 5_000,
    escrowReleasedAt: null as Date | null,
    donation: { campaignId: 'campaign-1' },
    registration: null as { batch: { tripId: string } } | null,
    ...overrides,
  };
}

function makeTripPayment(overrides: Record<string, unknown> = {}) {
  return makePayment({
    donation: null,
    registration: { batch: { tripId: 'trip-1' } },
    ...overrides,
  });
}

/**
 * Minimal in-memory stand-in for a Prisma transaction client, reusing the
 * same ledgerEntry.groupBy/createMany simulation as
 * src/lib/money/payouts.test.ts, so campaignBalance/tripBalance/
 * escrowBalance/tripEscrowBalance and postTransaction are exercised for
 * real rather than mocked away.
 */
function makeTx(
  options: {
    ledgerRows?: LedgerRow[];
    payment?: ReturnType<typeof makePayment> | null;
    isDemo?: boolean;
    priorRefunds?: Array<{ amount: number; status: string }>;
    refundRow?: Record<string, unknown> | null;
  } = {},
) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const payment = options.payment === undefined ? makePayment() : options.payment;
  const refundCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'refund-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedById: null,
    providerRef: null,
    ...data,
  }));
  const state = options.refundRow ? { ...options.refundRow } : null;
  const refundFindUnique = vi.fn().mockResolvedValue(state);
  const refundUpdateMany = vi.fn(
    async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
      if (!state || state.status !== where.status) return { count: 0 };
      Object.assign(state, data);
      return { count: 1 };
    },
  );
  const queryRawCalls: string[] = [];

  return {
    tx: {
      $queryRaw: vi.fn((strings: TemplateStringsArray) => {
        const text = strings.join('');
        queryRawCalls.push(text);
        if (text.includes('"Payment"')) {
          return Promise.resolve(payment ? [{ id: payment.id }] : []);
        }
        return Promise.resolve([{ id: 'locked' }]);
      }),
      payment: {
        findUniqueOrThrow: vi.fn(async () => payment),
      },
      campaign: { findUnique: vi.fn().mockResolvedValue({ isDemo: options.isDemo ?? false }) },
      refund: {
        create: refundCreate,
        findUnique: refundFindUnique,
        findMany: vi.fn().mockResolvedValue(options.priorRefunds ?? []),
        updateMany: refundUpdateMany,
      },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
          const filtered = rows.filter((r) => {
            const w = args.where ?? {};
            return Object.entries(w).every(([k, v]) => (r as never as Record<string, unknown>)[k] === v);
          });
          const buckets = new Map<string, { row: Record<string, unknown>; sum: number }>();
          for (const r of filtered) {
            const key = args.by.map((k) => String((r as never as Record<string, unknown>)[k])).join('|');
            const b = buckets.get(key) ?? {
              row: Object.fromEntries(args.by.map((k) => [k, (r as never as Record<string, unknown>)[k]])),
              sum: 0,
            };
            b.sum += r.amount;
            buckets.set(key, b);
          }
          return Array.from(buckets.values()).map((b) => ({ ...b.row, _sum: { amount: b.sum } }));
        }),
      },
    },
    refundCreate,
    rows,
    queryRawCalls,
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>['tx'], finalRow: Record<string, unknown>) {
  return {
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    refund: { findUniqueOrThrow: vi.fn().mockResolvedValue(finalRow) },
  };
}

describe('createRefund', () => {
  it('freezes funds from ESCROW_HOLD when the Payment has not matured, crediting FROZEN_BALANCE', async () => {
    const { tx, refundCreate, rows } = makeTx({ payment: makePayment({ escrowReleasedAt: null }) });

    const refund = await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'Dibayar dua kali',
      requestedById: 'admin-1',
    });

    expect(refund.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-1', amount: 40_000, requestedById: 'admin-1', status: 'REQUESTED' }) }),
    );
    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 40_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 40_000, campaignId: 'campaign-1' }),
    ]);
  });

  it('freezes funds from CAMPAIGN_BALANCE once the Payment has matured', async () => {
    const { tx, rows } = makeTx({ payment: makePayment({ escrowReleasedAt: new Date('2026-01-01') }) });

    await createRefund(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted[0]).toMatchObject({ account: 'CAMPAIGN_BALANCE', direction: 'DEBIT' });
  });

  it('freezes funds from TRIP_BALANCE for a matured Trip subject, never touching CAMPAIGN_BALANCE', async () => {
    const { tx, rows } = makeTx({ payment: makeTripPayment({ escrowReleasedAt: new Date('2026-01-01') }) });

    await createRefund(tx as never, {
      subject: { type: 'trip', tripId: 'trip-1' },
      paymentId: 'payment-1',
      amount: 40_000,
      reason: 'x',
      requestedById: 'admin-1',
    });

    const posted = rows.filter((r) => r.transactionId === 'refund-requested-refund-1');
    expect(posted.some((r) => r.account === 'CAMPAIGN_BALANCE')).toBe(false);
    expect(posted[0]).toMatchObject({ account: 'TRIP_BALANCE', direction: 'DEBIT', volunteerTripId: 'trip-1', campaignId: null });
  });

  it('rejects a demo Campaign with DemoCampaignError before ever creating a Refund row', async () => {
    const { tx, refundCreate } = makeTx({ isDemo: true });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(DemoCampaignError);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('never runs the isDemo check for a Trip subject -- VolunteerTrip has no isDemo field', async () => {
    const { tx } = makeTx({ payment: makeTripPayment() });

    await createRefund(tx as never, { subject: { type: 'trip', tripId: 'trip-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' });

    expect(tx.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('throws PaymentNotFoundError when the Payment row lock finds nothing', async () => {
    const { tx } = makeTx({ payment: null });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'missing', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(PaymentNotFoundError);
  });

  it('throws PaymentSubjectMismatchError when the Payment is Campaign-linked but a Trip subject is given', async () => {
    const { tx } = makeTx({ payment: makePayment({ donation: { campaignId: 'a-different-campaign' } }) });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(PaymentSubjectMismatchError);
  });

  it('throws PaymentSubjectMismatchError when the Payment is Trip-linked but a Campaign subject is given', async () => {
    const { tx } = makeTx({ payment: makeTripPayment() });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(PaymentSubjectMismatchError);
  });

  it('subtracts every prior non-rejected/failed Refund from what is still refundable', async () => {
    const { tx, refundCreate } = makeTx({
      payment: makePayment({ amount: 100_000 }),
      priorRefunds: [{ amount: 40_000, status: 'REQUESTED' }],
    });

    await expect(
      createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 65_000, reason: 'x', requestedById: 'admin-1' }),
    ).rejects.toThrow(RefundExceedsRemainingError);
    expect(refundCreate).not.toHaveBeenCalled();

    // Exactly the remaining 60_000 succeeds.
    await createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 60_000, reason: 'x', requestedById: 'admin-1' });
    expect(refundCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT count a REJECTED prior Refund against what is still refundable', async () => {
    const { tx, refundCreate } = makeTx({
      payment: makePayment({ amount: 100_000 }),
      priorRefunds: [{ amount: 90_000, status: 'REJECTED' }],
    });

    await createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 100_000, reason: 'x', requestedById: 'admin-1' });
    expect(refundCreate).toHaveBeenCalledTimes(1);
  });

  it('locks the Payment row before computing the remaining-refundable cap', async () => {
    const { tx, queryRawCalls } = makeTx();

    await createRefund(tx as never, { subject: { type: 'campaign', campaignId: 'campaign-1' }, paymentId: 'payment-1', amount: 1, reason: 'x', requestedById: 'admin-1' });

    expect(queryRawCalls.some((q) => q.includes('"Payment"') && q.includes('FOR UPDATE'))).toBe(true);
  });
});

describe('approveRefund', () => {
  const baseRefundRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'refund-1',
    paymentId: 'payment-1',
    amount: 40_000,
    reason: 'x',
    status: 'REQUESTED',
    requestedById: 'requester-1',
    approvedById: null,
    payment: makePayment(),
    ...overrides,
  });

  it('settles a full refund with zero fees cleanly: FROZEN_BALANCE debited the full amount, no PLATFORM_FEE/REFUND_COST legs', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED', approvedById: 'admin-1' });

    const result = await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    expect(result.status).toBe('APPROVED');
    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'REFUND_CLEARING', direction: 'CREDIT', amount: 100_000 }),
      expect.objectContaining({ account: 'FROZEN_BALANCE', direction: 'DEBIT', amount: 100_000, campaignId: 'campaign-1' }),
    ]);
    expect(posted.some((r) => r.account === 'PLATFORM_FEE')).toBe(false);
    expect(posted.some((r) => r.account === 'REFUND_COST')).toBe(false);
  });

  it('splits a full refund with a nonzero Provider Fee: FROZEN_BALANCE gets the net, REFUND_COST gets the fee', async () => {
    // Gross 100_000, Provider Fee 5_000 -- refundApprovedLegs must debit
    // FROZEN_BALANCE 95_000 and REFUND_COST 5_000, summing to exactly 100_000.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makePayment({ amount: 100_000, providerFee: 5_000 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ direction: 'DEBIT', amount: 95_000 });
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ direction: 'DEBIT', amount: 5_000 });
    expect(posted.find((r) => r.account === 'REFUND_CLEARING')).toMatchObject({ direction: 'CREDIT', amount: 100_000 });
    const debitTotal = posted.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amount, 0);
    expect(debitTotal).toBe(100_000);
  });

  it('rounds the proportional Provider Fee UP on a partial refund', async () => {
    // Gross 100_000, Provider Fee 3_333, refunding half (50_000): the
    // proportional share is 3_333 * 50_000 / 100_000 = 1_666.5, rounded up
    // to 1_667 -- a known literal, not recomputed the same way as the code.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 50_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({ amount: 50_000, payment: makePayment({ amount: 100_000, providerFee: 3_333 }) });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 1_667 });
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ amount: 48_333 });
  });

  it('folds a shortfall into REFUND_COST when the subject pool has gone negative from the freeze, never driving FROZEN_BALANCE debit below zero', async () => {
    // CAMPAIGN_BALANCE holds only 10_000 after the freeze already debited it
    // by the full 100_000 Gross (net credited was 95_000, an 85_000 Payout
    // already went out). recoverableFromFrozen = 100_000 - 5_000 = 95_000;
    // poolBalance = -90_000; shortfall = min(90_000, 95_000) = 90_000.
    // FROZEN_BALANCE debit = 95_000 - 90_000 = 5_000. REFUND_COST debit =
    // 5_000 (provider fee) + 90_000 (shortfall) = 95_000. Sum = 100_000.
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 95_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'payout-1', direction: 'DEBIT', amount: 85_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const refundRow = baseRefundRow({
      amount: 100_000,
      payment: makePayment({ amount: 100_000, providerFee: 5_000, escrowReleasedAt: new Date('2026-01-01') }),
    });
    const { tx, rows } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ amount: 5_000 });
    expect(posted.find((r) => r.account === 'REFUND_COST')).toMatchObject({ amount: 95_000 });
    expect(posted.find((r) => r.account === 'REFUND_CLEARING')).toMatchObject({ amount: 100_000 });
  });

  it('settles a Trip-linked refund debiting FROZEN_BALANCE with volunteerTripId, never touching a Campaign row', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      { transactionId: 'freeze-1', direction: 'DEBIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const refundRow = baseRefundRow({ amount: 100_000, payment: makeTripPayment({ amount: 100_000, providerFee: 0 }) });
    const { tx, rows, queryRawCalls } = makeTx({ ledgerRows, refundRow });
    const prisma = makePrisma(tx, { ...refundRow, status: 'APPROVED' });

    await approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'refund-approved-refund-1');
    expect(posted.some((r) => r.campaignId)).toBe(false);
    expect(posted.find((r) => r.account === 'FROZEN_BALANCE')).toMatchObject({ volunteerTripId: 'trip-1' });
    expect(queryRawCalls.some((q) => q.includes('VolunteerTrip'))).toBe(true);
    expect(queryRawCalls.some((q) => q.includes('"Campaign"'))).toBe(false);
  });

  it('refuses self-approval', async () => {
    const { tx } = makeTx({ refundRow: baseRefundRow({ requestedById: 'same-person' }) });
    const prisma = makePrisma(tx, baseRefundRow());

    await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'same-person' })).rejects.toThrow(SelfApprovalError);
  });

  it('throws RefundNotFoundError for a nonexistent Refund', async () => {
    const { tx } = makeTx({ refundRow: null });
    const prisma = makePrisma(tx, {});

    await expect(approveRefund(prisma as never, { refundId: 'missing', approvedById: 'admin-1' })).rejects.toThrow(RefundNotFoundError);
  });

  it('throws InvalidRefundStatusError when the Refund is already APPROVED, REJECTED, or FAILED', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'FAILED']) {
      const { tx } = makeTx({ refundRow: baseRefundRow({ status }) });
      const prisma = makePrisma(tx, baseRefundRow({ status }));

      await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' })).rejects.toThrow(InvalidRefundStatusError);
    }
  });

  it('REGRESSION: a second concurrent approval loses the race and posts nothing', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx, rows } = makeTx({ ledgerRows, refundRow: baseRefundRow() });
    // Simulates another approval having already flipped this Refund's status
    // out of REQUESTED between this call's read and its write -- exactly
    // what a real database's WHERE-matched updateMany returns for the loser.
    tx.refund.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = makePrisma(tx, baseRefundRow());

    await expect(approveRefund(prisma as never, { refundId: 'refund-1', approvedById: 'admin-1' })).rejects.toThrow(InvalidRefundStatusError);
    expect(rows.filter((r) => r.transactionId === 'refund-approved-refund-1')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/money/refunds.test.ts`
Expected: FAIL — `Cannot find module './refunds'`.

- [ ] **Step 4: Implement `src/lib/money/refunds.ts`**

```typescript
import type { Payment, Prisma, PrismaClient, Refund } from '@/generated/prisma/client';
import {
  campaignBalance,
  tripBalance,
  escrowBalance,
  tripEscrowBalance,
  postTransaction,
  refundRequestedLegs,
  refundApprovedLegs,
  type LedgerSubject,
} from './ledger';
import { DemoCampaignError } from './payouts';

/**
 * Refund: request, approve.
 *
 * Ported from the same two-person disbursement discipline as
 * src/lib/money/payouts.ts, generalized over subject: LedgerSubject from
 * day one (see the spec's own User Story 11) rather than forked into a
 * Trip-scoped sibling later.
 *
 * This ticket's own code only ever produces REQUESTED and APPROVED --
 * AWAITING_DONOR_DETAILS, PROCESSING, COMPLETED, REJECTED, FAILED stay in
 * the schema's enum for the donor-facing flow and the reject/cancel path,
 * neither of which this ticket builds a route for.
 */

export { DemoCampaignError };

export class PaymentNotFoundError extends Error {
  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} not found.`);
    this.name = 'PaymentNotFoundError';
  }
}

export class PaymentSubjectMismatchError extends Error {
  constructor(readonly paymentId: string) {
    super(
      `Payment ${paymentId} does not belong to the given subject -- a Campaign-linked Payment ` +
        'was refunded against a Trip subject, a Trip-linked one against a Campaign subject, or ' +
        'against the wrong Campaign/Trip entirely.',
    );
    this.name = 'PaymentSubjectMismatchError';
  }
}

export class RefundExceedsRemainingError extends Error {
  constructor(
    readonly requested: number,
    readonly remaining: number,
  ) {
    super(
      `Requested refund of ${requested} exceeds the ${remaining} still refundable on this Payment ` +
        '(its Gross minus every prior Refund that is not REJECTED or FAILED -- REQUESTED refunds ' +
        'count too, since their funds are already frozen).',
    );
    this.name = 'RefundExceedsRemainingError';
  }
}

export class RefundNotFoundError extends Error {
  constructor(readonly refundId: string) {
    super(`Refund ${refundId} not found.`);
    this.name = 'RefundNotFoundError';
  }
}

export class SelfApprovalError extends Error {
  constructor() {
    super(
      'approvedById equals requestedById. The two-person rule is this equality check and ' +
        'nothing else -- refused before any write, not recorded as a decision.',
    );
    this.name = 'SelfApprovalError';
  }
}

export class InvalidRefundStatusError extends Error {
  constructor(
    readonly currentStatus: string,
    detail?: string,
  ) {
    super(`Refund status is ${currentStatus}; this transition is not allowed.${detail ? ` (${detail})` : ''}`);
    this.name = 'InvalidRefundStatusError';
  }
}

/** Integer-safe ceiling division -- every proportional fee split rounds up, never down. */
function ceilDiv(numerator: number, denominator: number): number {
  return Math.ceil(numerator / denominator);
}

type PaymentWithSubjectLinks = Pick<Payment, 'amount' | 'providerFee' | 'escrowReleasedAt'> & {
  donation: { campaignId: string } | null;
  registration: { batch: { tripId: string } } | null;
};

/**
 * Which Campaign-or-Trip a Payment belongs to, read off whichever of
 * donation/registration is actually set -- the same derivation
 * src/lib/money/escrow.ts already uses for the identical purpose.
 */
function paymentSubjectOf(payment: PaymentWithSubjectLinks): LedgerSubject {
  return payment.donation
    ? { type: 'campaign', campaignId: payment.donation.campaignId }
    : { type: 'trip', tripId: payment.registration!.batch.tripId };
}

function sameSubject(a: LedgerSubject, b: LedgerSubject): boolean {
  if (a.type !== b.type) return false;
  return a.type === 'campaign'
    ? a.campaignId === (b as { campaignId: string }).campaignId
    : a.tripId === (b as { tripId: string }).tripId;
}

/**
 * ESCROW_HOLD while the Payment's escrow hasn't matured, the subject's
 * withdrawable balance once it has. Re-derived fresh at both createRefund
 * and approveRefund time -- escrow can mature in the window between the
 * two, and each call cares about where the pool sits right now, not where
 * it sat when the other call ran.
 */
function sourceFor(
  payment: Pick<Payment, 'escrowReleasedAt'>,
  subject: LedgerSubject,
): 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE' {
  if (payment.escrowReleasedAt == null) return 'ESCROW_HOLD';
  return subject.type === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE';
}

async function poolBalanceFor(
  tx: Prisma.TransactionClient,
  subject: LedgerSubject,
  source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE',
): Promise<number> {
  if (source === 'ESCROW_HOLD') {
    return subject.type === 'campaign' ? escrowBalance(tx, subject.campaignId) : tripEscrowBalance(tx, subject.tripId);
  }
  return subject.type === 'campaign' ? campaignBalance(tx, subject.campaignId) : tripBalance(tx, subject.tripId);
}

/**
 * An Admin creates a Refund for a Payment. Locks the Payment row first --
 * the contended resource for the cumulative-refund-cap check below is this
 * Payment's own remaining refundable amount, not the subject's aggregate
 * balance, so two concurrent createRefund calls against two DIFFERENT
 * Payments on the same Campaign do not contend here at all, but two against
 * the SAME Payment must not both read the same prior-refunds sum and both
 * pass the cap before either commits.
 *
 * Unlike requestPayout (which posts nothing at request time), this
 * immediately posts a two-leg freeze in the same transaction -- the PRD's
 * "seketika" requirement: a Campaign or Trip must not be able to spend
 * money that is already earmarked for return.
 */
export async function createRefund(
  tx: Prisma.TransactionClient,
  params: {
    subject: LedgerSubject;
    paymentId: string;
    amount: number;
    reason: string;
    requestedById: string;
  },
): Promise<Refund> {
  const { subject, paymentId, amount, reason, requestedById } = params;

  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  if (lockedRows.length === 0) {
    throw new PaymentNotFoundError(paymentId);
  }

  const payment = (await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { donation: true, registration: { include: { batch: true } } },
  })) as unknown as PaymentWithSubjectLinks & { id: string };

  const paymentSubject = paymentSubjectOf(payment);
  if (!sameSubject(subject, paymentSubject)) {
    throw new PaymentSubjectMismatchError(paymentId);
  }

  if (subject.type === 'campaign') {
    const campaign = await tx.campaign.findUnique({ where: { id: subject.campaignId }, select: { isDemo: true } });
    if (campaign?.isDemo) {
      throw new DemoCampaignError();
    }
  }

  const priorRefunds = await tx.refund.findMany({
    where: { paymentId, status: { notIn: ['REJECTED', 'FAILED'] } },
    select: { amount: true },
  });
  const alreadyCommitted = priorRefunds.reduce((sum: number, r: { amount: number }) => sum + r.amount, 0);
  const remaining = payment.amount - alreadyCommitted;
  if (amount > remaining) {
    throw new RefundExceedsRemainingError(amount, remaining);
  }

  const refund = await tx.refund.create({
    data: { paymentId, amount, reason, requestedById, status: 'REQUESTED' },
  });

  const source = sourceFor(payment, subject);
  await postTransaction(
    tx,
    refundRequestedLegs({ subject, amount, source }),
    { refundId: refund.id, paymentId, transactionId: `refund-requested-${refund.id}` },
  );

  return refund;
}

/**
 * A different Admin approves a REQUESTED Refund: posts the gross-
 * recognition settlement and lands on APPROVED. See refundApprovedLegs
 * (./ledger.ts) for the exact debit math and why "the three debits sum to
 * exactly amount" is the authoritative constraint over the spec's own
 * looser prose.
 */
export async function approveRefund(
  prisma: PrismaClient,
  params: { refundId: string; approvedById: string },
): Promise<Refund> {
  const { refundId, approvedById } = params;

  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: {
        payment: { include: { donation: true, registration: { include: { batch: true } } } },
      },
    });
    if (!refund) {
      throw new RefundNotFoundError(refundId);
    }

    if (refund.requestedById === approvedById) {
      throw new SelfApprovalError();
    }

    if (refund.status !== 'REQUESTED') {
      throw new InvalidRefundStatusError(refund.status);
    }

    const payment = refund.payment as unknown as PaymentWithSubjectLinks;
    const subject = paymentSubjectOf(payment);

    // Locks the subject, not the Refund row: the contended resource for the
    // shortfall computation below is the subject's pool, and a second,
    // different Refund against the same subject approved concurrently must
    // be serialised here, exactly mirroring approvePayout's own Campaign/
    // VolunteerTrip lock.
    if (subject.type === 'campaign') {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${subject.campaignId} FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM "VolunteerTrip" WHERE id = ${subject.tripId} FOR UPDATE`;
    }

    const source = sourceFor(payment, subject);
    const poolBalance = await poolBalanceFor(tx, subject, source);

    // Platform Fee is never charged anywhere in this codebase today -- no
    // Payment/Campaign field stores one, so there is nothing to multiply by
    // amount / payment.amount. Hardcoded, not derived, until such a field
    // exists; see the doc comment on refundApprovedLegs.
    const platformFeePortion = 0;
    const rawProviderFeePortion = ceilDiv(payment.providerFee * refund.amount, payment.amount);
    const providerFeePortion = Math.min(rawProviderFeePortion, refund.amount - platformFeePortion);
    const recoverableFromFrozen = refund.amount - platformFeePortion - providerFeePortion;
    const shortfall = poolBalance < 0 ? Math.min(-poolBalance, recoverableFromFrozen) : 0;

    const claimed = await tx.refund.updateMany({
      where: { id: refundId, status: 'REQUESTED' },
      data: { status: 'APPROVED', approvedById },
    });
    if (claimed.count === 0) {
      throw new InvalidRefundStatusError('unknown (changed concurrently)', 'lost the approval race');
    }

    await postTransaction(
      tx,
      refundApprovedLegs({
        subject,
        amount: refund.amount,
        platformFeePortion,
        providerFeePortion,
        shortfall,
      }),
      { refundId: refund.id, paymentId: refund.paymentId, transactionId: `refund-approved-${refund.id}` },
    );
  });

  return prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/money/refunds.test.ts src/lib/money/ledger.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS — the Task 1 baseline (130 files / 1344 tests) plus this task's new `refunds.test.ts` tests and `ledger.test.ts`'s updated tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/lib/money/ledger.ts src/lib/money/ledger.test.ts src/lib/money/refunds.ts src/lib/money/refunds.test.ts
git commit -m "feat: add createRefund/approveRefund, generalized over a Campaign-or-Trip subject

refundLegs (net-capped, single-step) is replaced by two builders matching
the PRD's two-phase Refund lifecycle: refundRequestedLegs (the immediate
2-leg freeze into FROZEN_BALANCE, new LedgerAccount) and
refundApprovedLegs (the gross-recognition settlement, up to 4 legs,
debiting FROZEN_BALANCE/PLATFORM_FEE/REFUND_COST -- new LedgerAccount --
summing to exactly the refunded amount, crediting REFUND_CLEARING for the
full Gross per ADR 0007).

createRefund locks the Payment row for the cumulative-refund-cap check,
validates subject/demo-Campaign, and posts the freeze. approveRefund
locks the subject row, recomputes the pool under lock to fold any
shortfall into REFUND_COST, and posts the settlement after a status-
predicated updateMany closes the same concurrent-approval race
approvePayout already closes. Both accept subject: LedgerSubject from day
one so ticket 05's Trip Fee refunds can call this core directly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Routes — `POST /api/campaigns/[slug]/refunds` and `PATCH /api/campaigns/[slug]/refunds/[id]/approve`

**Files:**
- Create: `src/app/api/campaigns/[slug]/refunds/route.ts`
- Create: `src/app/api/campaigns/[slug]/refunds/route.test.ts`
- Create: `src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts`
- Create: `src/app/api/campaigns/[slug]/refunds/[id]/approve/route.test.ts`

**Interfaces:**
- Consumes: `createRefund`, `approveRefund`, `DemoCampaignError`, `PaymentNotFoundError`, `PaymentSubjectMismatchError`, `RefundExceedsRemainingError`, `RefundNotFoundError`, `SelfApprovalError`, `InvalidRefundStatusError` (Task 2, `@/lib/money/refunds`); `withAssignmentCheck` (existing, `@/lib/withAssignmentCheck`); `Assignment` (existing, `@/generated/prisma/client`); `getServerSession` (existing, `@/lib/auth`); `prisma` (existing, `@/lib/prisma`).
- Produces: `POST /api/campaigns/[slug]/refunds`, `PATCH /api/campaigns/[slug]/refunds/[id]/approve` — no other task consumes these directly.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler yang diekspor (`POST`, `PATCH`), diimpor dan dipanggil langsung dengan `@/lib/prisma` dan `@/lib/auth` di-mock, persis gaya `src/app/api/campaigns/[slug]/payouts/route.test.ts` dan `.../payouts/[id]/approve/route.test.ts` (baca kedua berkas itu secara penuh sebelum menulis test ini). Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: gating Admin-assignment (401 tanpa sesi, 403 tanpa assignment ADMIN), validasi bentuk request (400 untuk body tidak valid, tanpa pernah mencapai lapisan uang), pengecekan `paymentId` milik Campaign yang benar lewat `slug` (404 jika tidak), pengecekan Refund milik Campaign yang benar lewat `slug` pada rute approve (404 jika tidak, termasuk regresi cross-campaign eksplisit), dan pemetaan kode status untuk setiap error yang bisa dilempar lapisan uang (`DemoCampaignError`→403, `RefundExceedsRemainingError`→400, `SelfApprovalError`→403, `InvalidRefundStatusError`→409). Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests for `POST /api/campaigns/[slug]/refunds`**

```typescript
// src/app/api/campaigns/[slug]/refunds/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payment: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPaymentFindUnique = prisma.payment.findUnique as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

function makeTx(options: { ledgerRows?: LedgerRow[]; isDemo?: boolean; priorRefunds?: Array<{ amount: number; status: string }> } = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const refundCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'refund-1', createdAt: new Date(), ...data }));
  return {
    tx: {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'payment-1' }]),
      payment: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'payment-1',
          amount: 100_000,
          providerFee: 5_000,
          escrowReleasedAt: null,
          donation: { campaignId: 'campaign-1' },
          registration: null,
        }),
      },
      campaign: { findUnique: vi.fn().mockResolvedValue({ isDemo: options.isDemo ?? false }) },
      refund: { create: refundCreate, findMany: vi.fn().mockResolvedValue(options.priorRefunds ?? []) },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    },
    refundCreate,
    rows,
  };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/refunds', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-campaign' }) };
}

const VALID_BODY = { paymentId: 'payment-1', amount: 40_000, reason: 'Dibayar dua kali' };

describe('POST /api/campaigns/[slug]/refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockPaymentFindUnique.mockResolvedValue({ id: 'payment-1', donation: { campaignId: 'campaign-1' } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body without ever resolving the campaign', async () => {
    const response = await POST(postRequest({ paymentId: '', amount: -5, reason: '' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockCampaignFindUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
  });

  it("returns 404 when the Payment's Donation belongs to a different Campaign than the URL slug", async () => {
    mockPaymentFindUnique.mockResolvedValue({ id: 'payment-1', donation: { campaignId: 'a-different-campaign' } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the paymentId does not exist at all', async () => {
    mockPaymentFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('creates a REQUESTED Refund and returns 201 when everything checks out', async () => {
    const { tx, refundCreate } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-1', amount: 40_000, requestedById: 'admin-1' }) }),
    );
  });

  it('returns 403 for a demo Campaign, creating nothing', async () => {
    const { tx, refundCreate } = makeTx({ isDemo: true });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when the requested amount exceeds what is still refundable', async () => {
    const { tx, refundCreate } = makeTx({ priorRefunds: [{ amount: 90_000, status: 'REQUESTED' }] });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest({ ...VALID_BODY, amount: 20_000 }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/refund/i);
    expect(refundCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/campaigns/[slug]/refunds/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement `POST /api/campaigns/[slug]/refunds`**

```typescript
// src/app/api/campaigns/[slug]/refunds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import {
  createRefund,
  DemoCampaignError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
} from '@/lib/money/refunds';

const createRefundSchema = z.object({
  paymentId: z.string().min(1, 'Payment harus dipilih'),
  amount: z.number().int('Jumlah harus berupa bilangan bulat').min(1, 'Jumlah refund harus lebih dari 0'),
  reason: z.string().min(1, 'Alasan harus diisi').max(500, 'Alasan maksimal 500 karakter'),
});

/**
 * POST /api/campaigns/[slug]/refunds -- an Admin creates a Refund on behalf
 * of a Donor who cannot self-initiate one through the interface (PRD
 * ยง7.2). Admin-only on both ends, unlike Payout's Fundraiser-request +
 * Admin-approve shape.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: any) => {
  const { slug } = await context.params;
  const session = await getServerSession();
  const requestedById = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = createRefundSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }
  const { paymentId, amount, reason } = parsed.data;

  const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, donation: { select: { campaignId: true } } } });
  if (!payment || payment.donation?.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Payment tidak ditemukan untuk campaign ini' }, { status: 404 });
  }

  try {
    const refund = await prisma.$transaction((tx) =>
      createRefund(tx, {
        subject: { type: 'campaign', campaignId: campaign.id },
        paymentId,
        amount,
        reason,
        requestedById,
      }),
    );

    return NextResponse.json(
      {
        id: refund.id,
        paymentId: refund.paymentId,
        amount: refund.amount,
        reason: refund.reason,
        status: refund.status,
        createdAt: refund.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DemoCampaignError) {
      return NextResponse.json({ error: 'Ini adalah campaign contoh dan tidak memiliki dana nyata untuk direfund' }, { status: 403 });
    }
    if (error instanceof PaymentSubjectMismatchError) {
      return NextResponse.json({ error: 'Payment tidak ditemukan untuk campaign ini' }, { status: 404 });
    }
    if (error instanceof RefundExceedsRemainingError) {
      return NextResponse.json({ error: 'Jumlah refund melebihi sisa yang bisa direfund dari Payment ini' }, { status: 400 });
    }
    console.error('Error creating refund:', error);
    return NextResponse.json({ error: 'Gagal membuat refund' }, { status: 500 });
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/campaigns/[slug]/refunds/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Write the failing tests for `PATCH /api/campaigns/[slug]/refunds/[id]/approve`**

```typescript
// src/app/api/campaigns/[slug]/refunds/[id]/approve/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    refund: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockRefundFindUnique = prisma.refund.findUnique as unknown as Mock;
const mockRefundFindUniqueOrThrow = prisma.refund.findUniqueOrThrow as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function makeTx(options: { refundRow?: Record<string, unknown> | null } = {}) {
  const state = options.refundRow ? { ...options.refundRow } : null;
  return {
    tx: {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      refund: {
        findUnique: vi.fn().mockResolvedValue(state),
        updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
          if (!state || state.status !== where.status) return { count: 0 };
          Object.assign(state, data);
          return { count: 1 };
        }),
      },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    },
  };
}

function makeRefundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    paymentId: 'payment-1',
    amount: 40_000,
    status: 'REQUESTED',
    requestedById: 'requester-1',
    approvedById: null,
    payment: {
      amount: 100_000,
      providerFee: 5_000,
      escrowReleasedAt: null,
      donation: { campaignId: 'campaign-1' },
      registration: null,
    },
    ...overrides,
  };
}

function patchRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/refunds/refund-1/approve', { method: 'PATCH' });
}

function routeContext(id = 'refund-1') {
  return { params: Promise.resolve({ slug: 'test-campaign', id }) };
}

describe('PATCH /api/campaigns/[slug]/refunds/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-2', role: 'ADMIN', assignments: ['ADMIN'] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockRefundFindUnique.mockResolvedValue({ payment: { donation: { campaignId: 'campaign-1' } } });
    mockRefundFindUniqueOrThrow.mockResolvedValue(makeRefundRow({ status: 'APPROVED', approvedById: 'admin-2' }));
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it("returns 404 when the Refund's Payment belongs to a different Campaign than the URL slug", async () => {
    mockRefundFindUnique.mockResolvedValue({ payment: { donation: { campaignId: 'a-different-campaign' } } });
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the refund id does not exist at all', async () => {
    mockRefundFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('approves a REQUESTED refund and returns 200 with the updated status', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('APPROVED');
  });

  it('returns 403 when the approver is the same person who requested it', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'requester-1', role: 'ADMIN', assignments: ['ADMIN'] } });
    const { tx } = makeTx({ refundRow: makeRefundRow() });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(403);
  });

  it('returns 409 when the refund is no longer REQUESTED', async () => {
    const { tx } = makeTx({ refundRow: makeRefundRow({ status: 'APPROVED' }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run "src/app/api/campaigns/[slug]/refunds/[id]/approve/route.test.ts"`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 7: Implement `PATCH /api/campaigns/[slug]/refunds/[id]/approve`**

```typescript
// src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import {
  approveRefund,
  RefundNotFoundError,
  SelfApprovalError,
  InvalidRefundStatusError,
} from '@/lib/money/refunds';

/**
 * PATCH /api/campaigns/[slug]/refunds/[id]/approve -- a different Admin
 * approves a REQUESTED Refund and posts its settlement in the same action.
 */
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (_request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

  const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const refund = await prisma.refund.findUnique({
    where: { id },
    select: { payment: { select: { donation: { select: { campaignId: true } } } } },
  });
  if (!refund || refund.payment.donation?.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Refund tidak ditemukan' }, { status: 404 });
  }

  try {
    const updated = await approveRefund(prisma, { refundId: id, approvedById });

    return NextResponse.json({
      id: updated.id,
      paymentId: updated.paymentId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
    });
  } catch (error) {
    if (error instanceof RefundNotFoundError) {
      return NextResponse.json({ error: 'Refund tidak ditemukan' }, { status: 404 });
    }
    if (error instanceof SelfApprovalError) {
      return NextResponse.json({ error: 'Refund tidak dapat disetujui oleh orang yang mengajukannya' }, { status: 403 });
    }
    if (error instanceof InvalidRefundStatusError) {
      return NextResponse.json({ error: 'Refund tidak lagi menunggu persetujuan' }, { status: 409 });
    }
    console.error('Error approving refund:', error);
    return NextResponse.json({ error: 'Gagal menyetujui refund' }, { status: 500 });
  }
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run "src/app/api/campaigns/[slug]/refunds/[id]/approve/route.test.ts"`
Expected: PASS, all tests.

- [ ] **Step 9: Run the full suite**

Run: `npx vitest run`
Expected: PASS — the Task 2 baseline plus this task's new route tests, 0 failures.

- [ ] **Step 10: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -iE "refund" || echo "no type errors naming Refund"
```

Expected: `no type errors naming Refund`.

- [ ] **Step 11: Commit**

```bash
git add "src/app/api/campaigns/[slug]/refunds"
git commit -m "feat: Admin creates and approves a Campaign Refund

POST /api/campaigns/[slug]/refunds and PATCH .../refunds/[id]/approve,
both Admin-only on both ends (PRD ยง7.2: Donors cannot self-initiate a
refund through the interface), mirroring the Campaign payout routes'
structure. Proves createRefund/approveRefund end-to-end for the
simplest, always-available trigger: an Admin creates a Refund for a
Payment a Donor was charged in error, paid twice, or paid into the wrong
Campaign. No Trip-side route in this ticket -- ticket 05 builds its own
on top of the already-generalized core.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
