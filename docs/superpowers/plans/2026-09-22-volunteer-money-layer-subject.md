# Volunteer Money-Layer Subject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the shared money-movement primitives (ledger leg-builders, the double-entry post function, balance queries, two reconcile checks) so they can carry either a Campaign or a Volunteer Trip as their subject, with zero behavior change for the existing Campaign path.

**Architecture:** `Payment`, `Payout`, and `LedgerEntry` each gain a nullable Trip-side FK alongside their existing Campaign-side one (exactly one of the pair is ever set). As of this plan, `VolunteerTrip` does not exist in `prisma/schema.prisma` yet (confirmed by reading the file), so all three new columns are added as plain scalar columns with no `@relation` — a later ticket (02 for `Payout`/`LedgerEntry`'s `volunteerTripId`, 03 for `Payment.registrationId`) wires up the real relation once the referenced model exists. The four ledger leg-builders in `lib/money/ledger.ts` and the campaign balance queries take an explicit `subject` discriminated union from their caller instead of a bare `campaignId` — they never look anything up themselves, so this is a pure signature generalization, fully testable with a synthetic trip id string. Two of `GET /api/admin/reconcile`'s four money checks (`negativeBalances`, `stuckPayouts`) get Trip-scoped siblings, since both only need a payment/payout's own direct FK. Nothing that requires resolving *which* Volunteer Trip a Payment belongs to (i.e. anything that would need to traverse `Payment.registration.batch.tripId`) is in scope here — `Registration` and `VolunteerBatch` don't exist yet, so that code cannot compile in this plan. That work (the escrow-release sweep's generalization, the settlement webhook's Trip branch, and reconcile's `strandedEscrow`/`deferredEscrowWatchdog` Trip variants) belongs to Ticket 03, not this plan.

**Tech Stack:** Next.js, Prisma, Postgres, Vitest.

**Spec:** .scratch/volunteer-trip/spec.md (ticket: .scratch/volunteer-trip/issues/01-money-layer-campaign-or-trip-subject.md)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    <akar specflow>/scripts/check-plan-headings.sh    <rencana ini> <task-brief>
    <akar specflow>/scripts/check-seam-constraints.sh <rencana ini> <task-brief>

## Global Constraints

- `Payment.donationId` becomes nullable; new nullable unique `registrationId` added, as a plain scalar column with no `@relation` (`Registration` model doesn't exist yet — Ticket 03 adds the relation). Exactly one of the two is ever set, enforced at the application level.
- `Payout.campaignId` becomes nullable; new nullable `volunteerTripId` added, same exactly-one-of-two shape, as a plain scalar column (`VolunteerTrip` doesn't exist yet — Ticket 02 adds the relation).
- `LedgerEntry` gets new nullable `volunteerTripId` alongside its existing nullable `campaignId`, same plain-scalar treatment. A Trip-scoped entry sets `volunteerTripId` and leaves `campaignId` null; a Campaign-scoped entry does the reverse; a platform-level entry leaves both null (unchanged from today).
- `LedgerAccount` gains exactly one new value: `TRIP_BALANCE`. No other new account — `ESCROW_HOLD`/`GATEWAY_CLEARING`/`PROVIDER_FEE`/`PAYOUT_CLEARING`/`REFUND_CLEARING` are reused as-is for Trip money, distinguished only by which FK the entry carries.
- `Refund` needs no schema change in this plan.
- No change to `Campaign`, `Donation`, `CampaignStatus`, or any Campaign-only route or its behavior.
- Out of scope: adding `volunteer` as a fifth Campaign Kind (rejected by ADR 0014). Out of scope: `VolunteerTrip`/`VolunteerBatch`/`Registration` models. Out of scope: `releaseMaturedEscrow`'s Trip generalization, the settlement webhook's Trip branch, and reconcile's `strandedEscrow`/`deferredEscrowWatchdog` Trip variants — all Ticket 03's, because they need `Registration`/`VolunteerBatch` to exist to compile.
- Every existing test in `lib/money/ledger.test.ts`, `lib/money/escrow.test.ts`, `lib/money/payouts.ts`'s test file, `api/webhooks/[provider]/route.test.ts`, and `api/admin/reconcile/route.test.ts` must still pass unchanged after this plan.

---

### Task 1: Schema migration and the Payment-subject validation helper

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_generalize_money_layer_subject/migration.sql`
- Create: `src/lib/money/payment-subject.ts`
- Test: `src/lib/money/payment-subject.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces: the schema fields `Payment.registrationId`, `Payout.volunteerTripId`, `LedgerEntry.volunteerTripId`, and `LedgerAccount.TRIP_BALANCE`, which Tasks 2 and 3 both consume. Produces `assertExactlyOnePaymentSubject(params: { donationId?: string | null; registrationId?: string | null }): void` and `InvalidPaymentSubjectError`, exported from `src/lib/money/payment-subject.ts`, for Ticket 03 to reuse when it builds the registration route (not called from any route in this plan — `POST /api/donations` is unaffected and out of scope).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah pemanggilan langsung terhadap fungsi yang diekspor (`assertExactlyOnePaymentSubject`), bukan lewat route. Cakup SETIAP kombinasi input (donationId saja, registrationId saja, keduanya, tidak satu pun, string kosong sebagai id yang valid) MELALUI seam itu. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing test for the Payment-subject validation helper**

```typescript
// src/lib/money/payment-subject.test.ts
import { describe, it, expect } from 'vitest';
import { assertExactlyOnePaymentSubject, InvalidPaymentSubjectError } from './payment-subject';

describe('assertExactlyOnePaymentSubject', () => {
  it('accepts donationId alone', () => {
    expect(() => assertExactlyOnePaymentSubject({ donationId: 'don-1' })).not.toThrow();
  });

  it('accepts registrationId alone', () => {
    expect(() => assertExactlyOnePaymentSubject({ registrationId: 'reg-1' })).not.toThrow();
  });

  it('rejects both set', () => {
    expect(() =>
      assertExactlyOnePaymentSubject({ donationId: 'don-1', registrationId: 'reg-1' }),
    ).toThrow(InvalidPaymentSubjectError);
  });

  it('rejects neither set', () => {
    expect(() => assertExactlyOnePaymentSubject({})).toThrow(InvalidPaymentSubjectError);
  });

  it('rejects both explicitly null', () => {
    expect(() =>
      assertExactlyOnePaymentSubject({ donationId: null, registrationId: null }),
    ).toThrow(InvalidPaymentSubjectError);
  });

  it('treats an empty string id as set, not absent', () => {
    // An empty string is a real (if unusual) value, not "absent" -- only
    // null/undefined mean "not set". Guards against a loose falsy check.
    expect(() => assertExactlyOnePaymentSubject({ donationId: '', registrationId: 'reg-1' })).toThrow(
      InvalidPaymentSubjectError,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/money/payment-subject.test.ts`
Expected: FAIL — `Cannot find module './payment-subject'` (the file doesn't exist yet).

- [ ] **Step 3: Implement the validation helper**

```typescript
// src/lib/money/payment-subject.ts

/**
 * A Payment describes money for exactly one thing -- a Donation (Campaign
 * money) or a Registration (Volunteer Trip money), never both, never
 * neither. This is the guard for that invariant: Prisma cannot express
 * "exactly one of these two columns is set" as a schema constraint, so this
 * is checked here, in application code, before a Payment is ever created.
 */
export class InvalidPaymentSubjectError extends Error {
  constructor() {
    super(
      'A Payment must have exactly one of donationId or registrationId set -- both or neither ' +
        'means the money this Payment describes has no single thing it is for.',
    );
    this.name = 'InvalidPaymentSubjectError';
  }
}

export function assertExactlyOnePaymentSubject(params: {
  donationId?: string | null;
  registrationId?: string | null;
}): void {
  const hasDonation = params.donationId != null;
  const hasRegistration = params.registrationId != null;
  if (hasDonation === hasRegistration) {
    throw new InvalidPaymentSubjectError();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/money/payment-subject.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Modify the schema**

In `prisma/schema.prisma`, find the `LedgerAccount` enum and add the new value:

```prisma
enum LedgerAccount {
  ESCROW_HOLD
  CAMPAIGN_BALANCE
  TRIP_BALANCE
  PLATFORM_FEE
  PROVIDER_FEE
  GATEWAY_CLEARING
  PAYOUT_CLEARING
  REFUND_CLEARING
}
```

Find the `Payment` model and change:

```prisma
model Payment {
  id          String        @id @default(cuid())
  donationId  String?       @unique
  donation    Donation?     @relation(fields: [donationId], references: [id])
  /// Set instead of donationId for a Trip Fee payment -- exactly one of the
  /// two is ever set, enforced by assertExactlyOnePaymentSubject
  /// (./src/lib/money/payment-subject.ts), not by a schema constraint
  /// Prisma cannot express. Plain scalar, no @relation: Registration
  /// doesn't exist yet -- Ticket 03 adds the relation once it does.
  registrationId String?    @unique
  provider    String
  ...
```

(Keep every other field of `Payment` exactly as it is — only `donationId` becomes optional and gains its sibling `donation Donation?`, and `registrationId` is added.)

Find the `Payout` model and change:

```prisma
model Payout {
  id            String       @id @default(cuid())
  campaignId    String?
  campaign      Campaign?    @relation(fields: [campaignId], references: [id])
  /// Set instead of campaignId for a Volunteer Trip payout. Plain scalar,
  /// no @relation: VolunteerTrip doesn't exist yet -- Ticket 02 adds the
  /// relation once it does.
  volunteerTripId String?
  bankAccountId String
  ...
```

(Keep every other field of `Payout` exactly as it is — only `campaignId` becomes optional and gains `campaign Campaign?`, and `volunteerTripId` is added.)

Find the `LedgerEntry` model and change:

```prisma
model LedgerEntry {
  id        String          @id @default(cuid())
  account   LedgerAccount
  direction LedgerDirection
  amount    Int

  campaignId String?
  campaign   Campaign? @relation(fields: [campaignId], references: [id])
  /// Trip-scoped sibling of campaignId, same optionality shape. Plain
  /// scalar, no @relation: VolunteerTrip doesn't exist yet -- Ticket 02
  /// adds the relation once it does.
  volunteerTripId String?

  paymentId String?
  ...
```

(Keep every other field of `LedgerEntry` exactly as it is.)

- [ ] **Step 6: Generate the Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client ... to ./src/generated/prisma`. This does not require a database connection.

- [ ] **Step 7: Write the migration SQL**

Check first whether a `DATABASE_URL` is reachable in your environment (`echo $DATABASE_URL`, and whether `npx prisma migrate dev --name generalize_money_layer_subject` succeeds). If it does, let it generate and apply the migration automatically and skip to Step 8. If there's no reachable database (there is none in the worktree this plan was written from), hand-write the migration file at `prisma/migrations/<YYYYMMDDHHMMSS>_generalize_money_layer_subject/migration.sql` (pick a timestamp later than the most recent existing migration directory's, e.g. by checking `ls prisma/migrations/`), matching this repo's existing Prisma-generated style:

```sql
-- AlterEnum
ALTER TYPE "LedgerAccount" ADD VALUE 'TRIP_BALANCE';

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "donationId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "registrationId" TEXT;
CREATE UNIQUE INDEX "Payment_registrationId_key" ON "Payment"("registrationId");

-- AlterTable
ALTER TABLE "Payout" ALTER COLUMN "campaignId" DROP NOT NULL;
ALTER TABLE "Payout" ADD COLUMN "volunteerTripId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "volunteerTripId" TEXT;
```

- [ ] **Step 8: Run the full existing test suite to confirm no regression from the schema change alone**

Run: `npx vitest run`
Expected: PASS, same file/test counts as this plan's baseline (117 files / 1174 tests) — the schema change alone must not break anything, since nothing yet reads or writes the new columns.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/money/payment-subject.ts src/lib/money/payment-subject.test.ts
git commit -m "feat: add Trip-side FK columns to Payment, Payout, LedgerEntry

Payment.donationId and Payout.campaignId become optional, each gaining a
plain-scalar Trip-side sibling (registrationId, volunteerTripId).
LedgerEntry gains volunteerTripId alongside its existing campaignId. No
@relation yet on any of the three new columns -- VolunteerTrip and
Registration don't exist in this schema yet; later tickets add the
relations once their models land. New TRIP_BALANCE ledger account.

assertExactlyOnePaymentSubject enforces the exactly-one-of-two invariant
Prisma can't express as a schema constraint, ready for Ticket 03's
registration route to reuse."
```

---

### Task 2: Generalize the ledger leg-builders and balance queries

**Files:**
- Modify: `src/lib/money/ledger.ts`
- Test: `src/lib/money/ledger.test.ts`

**Interfaces:**
- Consumes: `Payment.registrationId`/`Payout.volunteerTripId`/`LedgerEntry.volunteerTripId`/`LedgerAccount.TRIP_BALANCE` from Task 1.
- Produces: `LedgerSubject` type (`{ type: 'campaign'; campaignId: string } | { type: 'trip'; tripId: string }`), exported from `src/lib/money/ledger.ts`. `paymentSettledLegs`, `escrowReleaseLegs`, `refundLegs`, `payoutInstructedLegs` now take `{ subject: LedgerSubject; ... }` instead of `{ campaignId: string; ... }`. New `tripBalance(tx, tripId): Promise<number>` and `tripEscrowBalance(tx, tripId): Promise<number>`, siblings of the unchanged `campaignBalance`/`escrowBalance`. These are what Tickets 03/04/05 call when they need to post or read Trip-scoped money.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah pemanggilan langsung terhadap fungsi yang diekspor di `lib/money/ledger.ts` (leg-builder dan fungsi balance), bukan lewat route atau lewat `postTransaction` secara tidak langsung kecuali memang menguji `postTransaction` itu sendiri. Cakup SETIAP kombinasi subject (`campaign` dan `trip`) dan SETIAP jalur kegagalan (providerFee di luar rentang, refund amount melebihi creditedAmount) MELALUI seam itu, dengan id sintetis (string apa pun) untuk `tripId` -- tidak perlu baris `VolunteerTrip` nyata. Nilai harapan test harus literal (mis. bandingkan array leg persis, bukan menghitung ulang subjectFk dengan logika yang sama seperti kode).

- [ ] **Step 1: Write the failing tests for the generalized leg-builders**

Add to `src/lib/money/ledger.test.ts` (alongside its existing describe blocks — read the file first to match its existing import/setup style before appending):

```typescript
describe('paymentSettledLegs with a trip subject', () => {
  it('credits ESCROW_HOLD with volunteerTripId, not campaignId', () => {
    const legs = paymentSettledLegs({
      subject: { type: 'trip', tripId: 'trip-1' },
      grossAmount: 100_000,
      providerFee: 2_000,
    });
    expect(legs).toEqual([
      { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000 },
      { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 98_000, volunteerTripId: 'trip-1' },
      { account: 'PROVIDER_FEE', direction: 'CREDIT', amount: 2_000 },
    ]);
  });

  it('still credits ESCROW_HOLD with campaignId for a campaign subject, unchanged', () => {
    const legs = paymentSettledLegs({
      subject: { type: 'campaign', campaignId: 'camp-1' },
      grossAmount: 100_000,
      providerFee: 0,
    });
    expect(legs).toEqual([
      { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100_000 },
      { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 100_000, campaignId: 'camp-1' },
    ]);
  });
});

describe('escrowReleaseLegs with a trip subject', () => {
  it('credits TRIP_BALANCE, not CAMPAIGN_BALANCE', () => {
    const legs = escrowReleaseLegs({ subject: { type: 'trip', tripId: 'trip-1' }, amount: 50_000 });
    expect(legs).toEqual([
      { account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 50_000, volunteerTripId: 'trip-1' },
      { account: 'TRIP_BALANCE', direction: 'CREDIT', amount: 50_000, volunteerTripId: 'trip-1' },
    ]);
  });
});

describe('refundLegs with a trip subject', () => {
  it('accepts TRIP_BALANCE as a source', () => {
    const legs = refundLegs({
      subject: { type: 'trip', tripId: 'trip-1' },
      amount: 10_000,
      source: 'TRIP_BALANCE',
      creditedAmount: 10_000,
    });
    expect(legs).toEqual([
      { account: 'TRIP_BALANCE', direction: 'DEBIT', amount: 10_000, volunteerTripId: 'trip-1' },
      { account: 'REFUND_CLEARING', direction: 'CREDIT', amount: 10_000 },
    ]);
  });

  it('still refuses an amount exceeding creditedAmount for a trip subject', () => {
    expect(() =>
      refundLegs({
        subject: { type: 'trip', tripId: 'trip-1' },
        amount: 20_000,
        source: 'TRIP_BALANCE',
        creditedAmount: 10_000,
      }),
    ).toThrow(InvalidLedgerLegError);
  });
});

describe('payoutInstructedLegs with a trip subject', () => {
  it('debits TRIP_BALANCE, not CAMPAIGN_BALANCE', () => {
    const legs = payoutInstructedLegs({ subject: { type: 'trip', tripId: 'trip-1' }, amount: 30_000 });
    expect(legs).toEqual([
      { account: 'TRIP_BALANCE', direction: 'DEBIT', amount: 30_000, volunteerTripId: 'trip-1' },
      { account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: 30_000 },
    ]);
  });
});

describe('tripBalance / tripEscrowBalance', () => {
  it('separates held money from withdrawable money, per trip, mirroring the campaign case above', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'trip', tripId: 't1' }, grossAmount: 100_000, providerFee: 3_000 }),
    );

    expect(await tripEscrowBalance(tx as never, 't1')).toBe(97_000);
    expect(await tripBalance(tx as never, 't1')).toBe(0);

    await postTransaction(
      tx as never,
      escrowReleaseLegs({ subject: { type: 'trip', tripId: 't1' }, amount: 97_000 }),
    );
    expect(await tripEscrowBalance(tx as never, 't1')).toBe(0);
    expect(await tripBalance(tx as never, 't1')).toBe(97_000);

    await postTransaction(
      tx as never,
      payoutInstructedLegs({ subject: { type: 'trip', tripId: 't1' }, amount: 40_000 }),
    );
    expect(await tripBalance(tx as never, 't1')).toBe(57_000);
  });

  it('is zero for a trip with no movements', async () => {
    expect(await tripBalance(makeTx() as never, 'nobody')).toBe(0);
    expect(await tripEscrowBalance(makeTx() as never, 'nobody')).toBe(0);
  });

  it('CROSS-SUBJECT LEAKAGE: does not sum a CAMPAIGN_BALANCE entry into tripBalance for the same raw id value', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'shared-id' }, grossAmount: 100_000, providerFee: 0 }),
    );
    await postTransaction(
      tx as never,
      escrowReleaseLegs({ subject: { type: 'campaign', campaignId: 'shared-id' }, amount: 100_000 }),
    );
    expect(await tripBalance(tx as never, 'shared-id')).toBe(0);
    expect(await campaignBalance(tx as never, 'shared-id')).toBe(100_000);
  });

  it('CROSS-SUBJECT LEAKAGE: does not sum a TRIP_BALANCE entry into campaignBalance for the same raw id value', async () => {
    const tx = makeTx();
    await postTransaction(
      tx as never,
      paymentSettledLegs({ subject: { type: 'trip', tripId: 'shared-id' }, grossAmount: 50_000, providerFee: 0 }),
    );
    await postTransaction(
      tx as never,
      escrowReleaseLegs({ subject: { type: 'trip', tripId: 'shared-id' }, amount: 50_000 }),
    );
    expect(await campaignBalance(tx as never, 'shared-id')).toBe(0);
    expect(await tripBalance(tx as never, 'shared-id')).toBe(50_000);
  });
});
```

This reuses the file's real existing `makeTx()` fixture (defined near the top of the file) unchanged — its `groupBy`/`createMany`/`count` fakes are already generic over whatever fields a row has, so once `Row` (also near the top of the file) gains `volunteerTripId: string | null` (Step 3 below), these tests work with no fixture changes beyond that type.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/money/ledger.test.ts`
Expected: FAIL — `subject` is not a valid parameter on the current functions (TypeScript compile error) and `tripBalance`/`tripEscrowBalance` don't exist.

- [ ] **Step 2b: Update the test file's `Row` type and every existing test call to the new subject shape**

This file's `Row` type (near the top, backing the `makeTx()` fixture) currently has `campaignId: string | null` as a required field. Add its sibling:

```typescript
type Row = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};
```

Then update **every** existing call in this file to `paymentSettledLegs`, `escrowReleaseLegs`, `refundLegs`, and `payoutInstructedLegs` — there are roughly 34 occurrences of the old bare `{ campaignId: 'c1', ... }` shape across this file's existing tests (confirm the exact count with `grep -c "campaignId: 'c" src/lib/money/ledger.test.ts` before you start, and `grep -c "campaignId: 'c" src/lib/money/ledger.test.ts` again after — expect 0 after, since every one becomes `subject: { type: 'campaign', campaignId: 'c1' }`). For example, this existing call:

```typescript
await postTransaction(tx as never, paymentSettledLegs({ campaignId: 'c1', grossAmount: 100_000, providerFee: 3_000 }));
```

becomes:

```typescript
await postTransaction(tx as never, paymentSettledLegs({ subject: { type: 'campaign', campaignId: 'c1' }, grossAmount: 100_000, providerFee: 3_000 }));
```

This is a mechanical, signature-following change at every call site in this file — do not change any assertion, any expected value, or any test's intent. The literal `BALANCED` fixture array near the top of the file (used directly as `LedgerLeg[]`, not built through a leg-builder call) also needs its one `campaignId: 'c1'` entry left as-is — it's already constructing a raw `LedgerLeg` object directly, which still has `campaignId` as a valid optional field, not a call to a leg-builder function, so it is NOT part of this mechanical update.

- [ ] **Step 3: Implement the generalization in `src/lib/money/ledger.ts`**

Add the shared subject type near the top of the file, after the existing `PostOptions` interface:

```typescript
export type LedgerSubject =
  | { type: 'campaign'; campaignId: string }
  | { type: 'trip'; tripId: string };

function subjectFk(subject: LedgerSubject): { campaignId?: string; volunteerTripId?: string } {
  return subject.type === 'campaign'
    ? { campaignId: subject.campaignId }
    : { volunteerTripId: subject.tripId };
}

function balanceAccount(subject: LedgerSubject): 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE' {
  return subject.type === 'campaign' ? 'CAMPAIGN_BALANCE' : 'TRIP_BALANCE';
}
```

Update `LedgerLeg`:

```typescript
export interface LedgerLeg {
  account: LedgerAccount;
  direction: LedgerDirection;
  amount: number;
  /** Required for campaign-scoped accounts, omitted otherwise. */
  campaignId?: string;
  /** Required for trip-scoped accounts, omitted otherwise. */
  volunteerTripId?: string;
  memo?: string;
}
```

Update `postTransaction`'s `createMany` call to also write the new column (this is the one place the spec's own summary was wrong when it said "postTransaction needs no change" — verified against the real source: it hardcodes the `createMany` field list, so it does need this one line):

```typescript
  await tx.ledgerEntry.createMany({
    data: legs.map((leg) => ({
      account: leg.account,
      direction: leg.direction,
      amount: leg.amount,
      campaignId: leg.campaignId ?? null,
      volunteerTripId: leg.volunteerTripId ?? null,
      memo: leg.memo ?? null,
      paymentId: options.paymentId ?? null,
      refundId: options.refundId ?? null,
      payoutId: options.payoutId ?? null,
      transactionId,
    })),
  });
```

Replace `paymentSettledLegs`:

```typescript
export function paymentSettledLegs(params: {
  subject: LedgerSubject;
  grossAmount: number;
  providerFee: number;
}): LedgerLeg[] {
  const { subject, grossAmount, providerFee } = params;
  if (providerFee < 0 || providerFee > grossAmount) {
    throw new InvalidLedgerLegError(
      `providerFee ${providerFee} must be between 0 and the gross amount ${grossAmount}.`,
    );
  }
  const net = grossAmount - providerFee;

  const legs: LedgerLeg[] = [
    { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: grossAmount },
    { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: net, ...subjectFk(subject) },
  ];
  if (providerFee > 0) {
    legs.push({ account: 'PROVIDER_FEE', direction: 'CREDIT', amount: providerFee });
  }
  return legs;
}
```

Replace `escrowReleaseLegs`:

```typescript
export function escrowReleaseLegs(params: { subject: LedgerSubject; amount: number }): LedgerLeg[] {
  const { subject, amount } = params;
  return [
    { account: 'ESCROW_HOLD', direction: 'DEBIT', amount, ...subjectFk(subject) },
    { account: balanceAccount(subject), direction: 'CREDIT', amount, ...subjectFk(subject) },
  ];
}
```

Replace `refundLegs`:

```typescript
export function refundLegs(params: {
  subject: LedgerSubject;
  amount: number;
  source: 'ESCROW_HOLD' | 'CAMPAIGN_BALANCE' | 'TRIP_BALANCE';
  creditedAmount: number;
}): LedgerLeg[] {
  const { subject, amount, source, creditedAmount } = params;
  if (amount > creditedAmount) {
    throw new InvalidLedgerLegError(
      `Refund amount ${amount} exceeds the ${creditedAmount} this payment actually credited ` +
        `(the NET it credited, not the gross the donor paid) -- refusing to post a refund that ` +
        `would drive ${source} negative by the difference.`,
    );
  }
  return [
    { account: source, direction: 'DEBIT', amount, ...subjectFk(subject) },
    { account: 'REFUND_CLEARING', direction: 'CREDIT', amount },
  ];
}
```

Replace `payoutInstructedLegs`:

```typescript
export function payoutInstructedLegs(params: { subject: LedgerSubject; amount: number }): LedgerLeg[] {
  const { subject, amount } = params;
  return [
    { account: balanceAccount(subject), direction: 'DEBIT', amount, ...subjectFk(subject) },
    { account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount },
  ];
}
```

Update the internal `accountBalance` helper and add the Trip-scoped public functions, right after the existing `campaignBalance`/`escrowBalance`:

```typescript
async function accountBalance(
  tx: Prisma.TransactionClient,
  account: LedgerAccount,
  subject: LedgerSubject,
): Promise<number> {
  const where =
    subject.type === 'campaign'
      ? { account, campaignId: subject.campaignId }
      : { account, volunteerTripId: subject.tripId };

  const rows = await tx.ledgerEntry.groupBy({
    by: ['direction'],
    where,
    _sum: { amount: true },
  });

  let credits = 0;
  let debits = 0;
  for (const row of rows) {
    if (row.direction === 'CREDIT') credits = row._sum.amount ?? 0;
    if (row.direction === 'DEBIT') debits = row._sum.amount ?? 0;
  }
  return credits - debits;
}

export async function campaignBalance(tx: Prisma.TransactionClient, campaignId: string): Promise<number> {
  return accountBalance(tx, 'CAMPAIGN_BALANCE', { type: 'campaign', campaignId });
}

export async function escrowBalance(tx: Prisma.TransactionClient, campaignId: string): Promise<number> {
  return accountBalance(tx, 'ESCROW_HOLD', { type: 'campaign', campaignId });
}

/** Trip-scoped sibling of campaignBalance -- what a Volunteer Trip may actually withdraw. */
export async function tripBalance(tx: Prisma.TransactionClient, tripId: string): Promise<number> {
  return accountBalance(tx, 'TRIP_BALANCE', { type: 'trip', tripId });
}

/** Trip-scoped sibling of escrowBalance. */
export async function tripEscrowBalance(tx: Prisma.TransactionClient, tripId: string): Promise<number> {
  return accountBalance(tx, 'ESCROW_HOLD', { type: 'trip', tripId });
}
```

`campaignBalance`/`escrowBalance` keep their existing public signature (bare `campaignId: string`) unchanged — this avoids touching any of their existing call sites (`lib/money/payouts.ts`, the webhook route) in this plan, which are explicitly out of scope.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/money/ledger.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Run the full suite to confirm zero regression on the Campaign path**

Run: `npx vitest run`
Expected: PASS, 117 files / 1174 tests + the new tests added in this task, 0 failures. If anything in `lib/money/payouts.ts`'s or `escrow.ts`'s own test files fails, it means one of those files calls a leg-builder with the old bare-`campaignId` shape — find every call site of `paymentSettledLegs`, `escrowReleaseLegs`, `refundLegs`, `payoutInstructedLegs` in `src/` (`grep -rn` for each name) and update each call to wrap its existing `campaignId` in `subject: { type: 'campaign', campaignId }`. This is a mechanical signature-following change at each call site, not new logic — do not change any of those call sites' surrounding behavior.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money/ledger.ts src/lib/money/ledger.test.ts
git commit -m "feat: ledger leg-builders and balance queries accept a campaign-or-trip subject

paymentSettledLegs, escrowReleaseLegs, refundLegs, and payoutInstructedLegs
take an explicit LedgerSubject instead of a bare campaignId, so a Trip Fee
settlement can credit TRIP_BALANCE/ESCROW_HOLD scoped by volunteerTripId
the same way a donation credits CAMPAIGN_BALANCE/ESCROW_HOLD scoped by
campaignId. New tripBalance/tripEscrowBalance read it back. Every existing
Campaign call site updated to the new subject shape with no behavior
change; postTransaction's createMany gains the one line needed to persist
volunteerTripId, which its own doc comment previously (incorrectly)
implied wasn't necessary."
```

---

### Task 3: Generalize the reconcile route's negativeBalances and stuckPayouts checks

**Files:**
- Modify: `src/app/api/admin/reconcile/route.ts`
- Modify: `src/app/api/admin/reconcile/route.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry.volunteerTripId`, `LedgerAccount.TRIP_BALANCE`, `Payout.volunteerTripId` from Task 1.
- Produces: the reconcile report gains a new top-level `tripNegativeBalances` array (same shape as the existing `negativeBalances`, keyed by `volunteerTripId` instead of `campaignId`), and `stuckPayouts.processing`/`stuckPayouts.approvedWithoutProviderRef` entries each gain a `volunteerTripId` field. Nothing later in this plan consumes these directly (Ticket 03 is where a real Trip payout could first appear in this report), but they must be present and correctly shaped for Ticket 03 onward to rely on.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler yang diekspor (`GET`), diimpor dan dipanggil langsung dengan `@/lib/prisma` di-mock, seperti test yang sudah ada di file ini. Cakup SETIAP kondisi: tidak ada entry Trip sama sekali (array kosong, bukan hilang), satu Trip dengan saldo negatif, satu Trip dengan saldo positif (tidak muncul di `tripNegativeBalances`), dan Payout berstatus PROCESSING/APPROVED-tanpa-providerRef yang menunjuk ke `volunteerTripId` MELALUI seam itu. Nilai harapan pada assertion harus objek/array literal yang diketahui, bukan dihitung ulang dari input mock dengan logika yang sama seperti kode di route.

**Read this file's real fixtures first** (`src/app/api/admin/reconcile/route.test.ts`): `LedgerRow`/`PayoutRow` types, the `makeTx()` fixture (its `ledgerEntry.groupBy`/`payout.findMany` fakes), the shared `matchesWhere()` helper, and `createRequest()`. The steps below are written against that real code, not a sketch — read it anyway before editing, since exact line numbers will have shifted.

- [ ] **Step 1: Fix a real gap in `matchesWhere` before adding anything that depends on it**

`matchesWhere` (near the top of the file) currently does, for the `{ not: X }` filter shape:

```typescript
if ('not' in (v as Record<string, unknown>)) return row[k] !== (v as { not: unknown }).not;
```

A fixture row that never sets a given field has `row[k] === undefined`, and `undefined !== null` is `true` — so a Campaign-only row that never mentions `volunteerTripId` at all would *incorrectly* match a `{ volunteerTripId: { not: null } }` filter, the exact filter the new trip-scoped checks below need. Real Prisma never has this problem (a nullable column always reads back as `null`, never `undefined`), so fix the fake to match that reality rather than pushing `volunteerTripId: null` onto every one of this file's existing fixture rows. Change both branches that compare a raw value to normalize a missing field to `null` first:

```typescript
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const rowValue = row[k] ?? null;
    if (v && typeof v === 'object') {
      if ('not' in (v as Record<string, unknown>)) return rowValue !== (v as { not: unknown }).not;
      if ('in' in (v as Record<string, unknown>)) return (v as { in: unknown[] }).in.includes(rowValue);
      if ('lte' in (v as Record<string, unknown>)) {
        return rowValue != null && (rowValue as Date) <= (v as { lte: Date }).lte;
      }
    }
    return rowValue === v;
  });
}
```

Run `npx vitest run src/app/api/admin/reconcile/route.test.ts` right after this one change, before touching anything else, and confirm it's still 100% green — this is a behavior-preserving normalization for every existing filter shape this fake already handles (`campaignId: { not: null }` included), not a new behavior, so nothing should change yet.

- [ ] **Step 2: Add `volunteerTripId` to the fixture types and the payout fake's output, as optional fields**

In `LedgerRow`, add: `volunteerTripId?: string | null;` (optional — existing `ledgerRows` fixtures across this file are not required to set it, per Step 1's fix).

In `PayoutRow`, add: `volunteerTripId?: string | null;` (same reasoning).

In `makeTx()`'s `payout.findMany` fake, its `.map()` currently returns a fixed field list (`id`, `campaignId`, `amount`, `providerRef`, `approvedAt`) regardless of what `select` was asked for. Add the new field, defaulting an unset one to `null` to match real Prisma's own behavior for a nullable column:

```typescript
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        payouts
          .filter((p) => matchesWhere(p as never as Record<string, unknown>, where))
          .map((p) => ({
            id: p.id,
            campaignId: p.campaignId,
            volunteerTripId: p.volunteerTripId ?? null,
            amount: p.amount,
            providerRef: p.providerRef,
            approvedAt: p.approvedAt,
          })),
      ),
```

- [ ] **Step 3: Update the two existing `stuckPayouts` tests whose expected literals now need `volunteerTripId: null`**

Step 2's `?? null` default means every payout the route returns now carries an explicit `volunteerTripId` key (never `undefined`, which `JSON` would have silently dropped) — so the two existing tests asserting an exact `toEqual` on a Campaign-only payout need that key added to their expected object, or they'll fail on an unexpected extra property. Find the test `'lists a stuck PROCESSING payout'` (or however it's actually named — search for `status: 'PROCESSING'` in this file) and add `volunteerTripId: null` to its expected object:

```typescript
    expect(data.stuckPayouts.processing).toEqual([
      {
        payoutId: 'payout-1',
        campaignId: 'campaign-1',
        volunteerTripId: null,
        amount: 200_000,
        providerRef: 'provider-ref-1',
        approvedAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
```

Do the same for the `'lists an APPROVED payout with legs posted and no providerRef'` test (search for `providerRef: null` in a payout fixture):

```typescript
    expect(data.stuckPayouts.approvedWithoutProviderRef).toEqual([
      {
        payoutId: 'payout-2',
        campaignId: 'campaign-1',
        volunteerTripId: null,
        amount: 75_000,
        approvedAt: '2026-08-05T00:00:00.000Z',
      },
    ]);
```

This is the one place in this task where an *existing* test's expected value legitimately changes — everywhere else in this plan, existing tests pass completely unchanged. It changes because the route's own output shape gains a field for every payout, Campaign or Trip; it is not a behavior regression on the Campaign path.

- [ ] **Step 4: Write the new failing tests for the trip-scoped checks**

Append to the same file:

```typescript
describe('GET /api/admin/reconcile -- trip-scoped checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
  });

  it('reports an empty tripNegativeBalances when there are no trip-scoped ledger entries at all', async () => {
    const tx = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripNegativeBalances).toEqual([]);
  });

  it('flags a trip whose ESCROW_HOLD balance is negative', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'DEBIT', amount: 10_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripNegativeBalances).toEqual([
      { volunteerTripId: 'trip-1', account: 'ESCROW_HOLD', balance: -10_000 },
    ]);
  });

  it('does not flag a trip whose balance is positive', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'CREDIT', amount: 10_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-2' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripNegativeBalances).toEqual([]);
  });

  it('does not let a campaign-scoped negative balance leak into tripNegativeBalances', async () => {
    const tx = makeTx({
      ledgerRows: [
        { transactionId: 't1', direction: 'DEBIT', amount: 10_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.tripNegativeBalances).toEqual([]);
    expect(data.negativeBalances).toEqual([
      { campaignId: 'campaign-1', account: 'CAMPAIGN_BALANCE', balance: -10_000 },
    ]);
  });

  it('includes volunteerTripId on a stuck PROCESSING payout that belongs to a trip', async () => {
    const tx = makeTx({
      payouts: [
        {
          id: 'payout-3',
          campaignId: null,
          volunteerTripId: 'trip-3',
          amount: 60_000,
          status: 'PROCESSING',
          providerRef: 'provider-ref-3',
          approvedAt: new Date('2026-09-01'),
        } as never,
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.stuckPayouts.processing).toEqual([
      {
        payoutId: 'payout-3',
        campaignId: null,
        volunteerTripId: 'trip-3',
        amount: 60_000,
        providerRef: 'provider-ref-3',
        approvedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
  });

  it('includes volunteerTripId on an approved-without-providerRef payout that belongs to a trip', async () => {
    const tx = makeTx({
      payouts: [
        {
          id: 'payout-4',
          campaignId: null,
          volunteerTripId: 'trip-4',
          amount: 25_000,
          status: 'APPROVED',
          providerRef: null,
          approvedAt: new Date('2026-09-02'),
        } as never,
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(data.stuckPayouts.approvedWithoutProviderRef).toEqual([
      {
        payoutId: 'payout-4',
        campaignId: null,
        volunteerTripId: 'trip-4',
        amount: 25_000,
        approvedAt: '2026-09-02T00:00:00.000Z',
      },
    ]);
  });
});
```

(The `as never` on the two payout fixture literals is because `PayoutRow`'s existing type declares `campaignId: string`, required — not `string | null` — since every Campaign-path fixture always sets it; a Trip-only payout genuinely has `campaignId: null`. Widening `PayoutRow.campaignId` to `string | null` is the more correct fix if it doesn't force changes elsewhere in this file; try that first and only fall back to the cast if it cascades into unrelated existing fixtures.)

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/admin/reconcile/route.test.ts`
Expected: FAIL — `data.tripNegativeBalances` is `undefined`, and the new payout tests' expected `volunteerTripId` isn't present.

- [ ] **Step 6: Implement the route changes**

In `src/app/api/admin/reconcile/route.ts`, after the existing `negativeBalances` block (the `balanceRows`/`balances`/`negativeBalances` computation), add the Trip-scoped equivalent:

```typescript
    // Trip-scoped sibling of the negativeBalances check above -- same
    // shape, same reasoning, grouped by volunteerTripId instead of
    // campaignId, checking ESCROW_HOLD/TRIP_BALANCE instead of
    // ESCROW_HOLD/CAMPAIGN_BALANCE.
    const tripBalanceRows = await tx.ledgerEntry.groupBy({
      by: ['volunteerTripId', 'account', 'direction'],
      where: { volunteerTripId: { not: null } },
      _sum: { amount: true },
    });

    const tripBalances = new Map<string, Map<string, number>>();
    for (const row of tripBalanceRows) {
      const volunteerTripId = row.volunteerTripId as string;
      const perTrip = tripBalances.get(volunteerTripId) ?? new Map<string, number>();
      const signed = row.direction === 'CREDIT' ? (row._sum.amount ?? 0) : -(row._sum.amount ?? 0);
      perTrip.set(row.account, (perTrip.get(row.account) ?? 0) + signed);
      tripBalances.set(volunteerTripId, perTrip);
    }

    const tripNegativeBalances: Array<{ volunteerTripId: string; account: string; balance: number }> = [];
    for (const [volunteerTripId, perTrip] of Array.from(tripBalances.entries())) {
      for (const account of ['ESCROW_HOLD', 'TRIP_BALANCE'] as const) {
        const balance = perTrip.get(account) ?? 0;
        if (balance < 0) tripNegativeBalances.push({ volunteerTripId, account, balance });
      }
    }
```

Find the existing `processingPayouts`/`approvedWithoutProviderRef` queries and widen their `select`:

```typescript
    const processingPayouts = await tx.payout.findMany({
      where: { status: 'PROCESSING' },
      select: { id: true, campaignId: true, volunteerTripId: true, amount: true, providerRef: true, approvedAt: true },
    });
    const approvedWithoutProviderRef = await tx.payout.findMany({
      where: { status: 'APPROVED', providerRef: null },
      select: { id: true, campaignId: true, volunteerTripId: true, amount: true, approvedAt: true },
    });
```

And their mapped output (inside the returned `report.stuckPayouts` object):

```typescript
        processing: processingPayouts.map((p) => ({
          payoutId: p.id,
          campaignId: p.campaignId,
          volunteerTripId: p.volunteerTripId,
          amount: p.amount,
          providerRef: p.providerRef,
          approvedAt: p.approvedAt,
        })),
        approvedWithoutProviderRef: approvedWithoutProviderRef.map((p) => ({
          payoutId: p.id,
          campaignId: p.campaignId,
          volunteerTripId: p.volunteerTripId,
          amount: p.amount,
          approvedAt: p.approvedAt,
        })),
```

Add `tripNegativeBalances` to the returned `report` object, next to the existing `negativeBalances` key:

```typescript
    return {
      generatedAt: new Date().toISOString(),
      unbalancedTransactions,
      negativeBalances,
      tripNegativeBalances,
      preLedger,
      ...
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/admin/reconcile/route.test.ts`
Expected: PASS, all tests including the new ones and the two updated ones from Step 3.

- [ ] **Step 8: Add the `unbalancedTransactions`-already-covers-trips regression test**

Add to `src/lib/money/ledger.test.ts`, inside (or next to) the existing `describe('findUnbalancedTransactions', ...)` block. `postTransaction` itself refuses to post an unbalanced set of legs, so proving `findUnbalancedTransactions` catches a trip-scoped one means writing rows directly onto the fixture's exposed `tx.rows` array (bypassing `postTransaction`'s own guard on purpose, exactly as an undetected direct-write bug would):

```typescript
describe('findUnbalancedTransactions already covers trip-scoped entries', () => {
  it('flags a trip-scoped transaction whose legs do not sum to zero', async () => {
    const tx = makeTx();
    // Deliberately bypass postTransaction's own balance guard, writing
    // directly the way a real bug (not this plan's own code) would have
    // to reach the database to produce this state.
    tx.rows.push(
      { transactionId: 'trip-tx-1', direction: 'DEBIT', amount: 10_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-9' },
      { transactionId: 'trip-tx-1', direction: 'CREDIT', amount: 9_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-9' },
    );

    const result = await findUnbalancedTransactions(tx as never);

    expect(result).toEqual([{ transactionId: 'trip-tx-1', debits: 10_000, credits: 9_000 }]);
  });
});
```

(This requires `Row` — updated in Task 2, Step 2b — to have `volunteerTripId: string | null`, which it now does.)

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/lib/money/ledger.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suite one final time**

Run: `npx vitest run`
Expected: PASS, 0 failures. This is the plan's final regression gate — every Campaign-path test from before this plan started must still be green (with two `stuckPayouts` literals legitimately updated per Step 3), alongside every new test this plan added.

- [ ] **Step 11: Commit**

```bash
git add src/app/api/admin/reconcile/route.ts src/app/api/admin/reconcile/route.test.ts src/lib/money/ledger.test.ts
git commit -m "feat: reconcile report gains trip-scoped negativeBalances and stuckPayouts

tripNegativeBalances mirrors the existing campaign-scoped check, grouped by
volunteerTripId instead. stuckPayouts entries now carry volunteerTripId so
a stuck Trip payout is identifiable the same way a stuck Campaign payout
already is. strandedEscrow and deferredEscrowWatchdog's trip variants are
deliberately not added here -- they need Payment.registration.batch.tripId,
which doesn't compile without Registration/VolunteerBatch (Ticket 03).

Also proves findUnbalancedTransactions already covers trip-scoped
transactions with no code change, since it has never filtered by subject.

matchesWhere in the test fixture normalized a missing field to null before
comparing (matching real Prisma's own behavior for a nullable column) --
without it, an existing Campaign-only fixture row would have spuriously
matched a new { volunteerTripId: { not: null } } filter. Two existing
stuckPayouts tests' expected literals gained an explicit volunteerTripId:
null, the one place in this task an existing test's expected value
legitimately changes, since the route's own payout output shape now
carries that field for every payout."
```
