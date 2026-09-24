# Cancelled-Registration Settlement Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the settlement webhook finds a Trip Payment's Registration was cancelled out from under it (not merely "not HOLD"), automatically refund the Payment that just settled, and make every `REQUESTED` Refund — auto-created or not — discoverable via the reconcile report, since none is discoverable today.

**Architecture:** The webhook's existing settlement transaction gains one extra read (the Registration's actual current status, only when its own `updateMany` already found it wasn't `HOLD`) and carries that fact out to a NEW, separate transaction opened after the settlement commits — calling the already-generalized `createRefund` there, never inside the settlement transaction itself, because `createRefund` locks `VolunteerTrip`-then-`Payment` and the settlement transaction has already written `Payment`, so calling it inline would lock in the reverse of this codebase's established Campaign/VolunteerTrip-then-Payment order and reintroduce a real deadlock class. Reconcile gains one new combined (not Campaign/Trip-split) array listing every `REQUESTED` Refund.

**Tech Stack:** Next.js, Prisma, Postgres, Vitest.

**Spec:** .scratch/cancelled-registration-settlement-race/spec.md

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0.

    <akar specflow>/scripts/check-plan-headings.sh    <rencana ini> <task-brief>
    <akar specflow>/scripts/check-seam-constraints.sh <rencana ini> <task-brief>

## Global Constraints

- Only a Registration whose actual current status is `CANCELLED` triggers the new auto-refund path. Any other non-`HOLD` status found (in practice, only `EXPIRED` is reachable today) keeps the existing log-only behavior completely unchanged — this is NOT the ticket that resolves the still-open "hold merely expired" product question from ticket 03's final review.
- The auto-refund call happens in a fresh `prisma.$transaction`, opened AFTER the settlement transaction commits, in the same post-transaction block where `notifyRegistrationConfirmed`/`notifyDonationConfirmed` already run. It must NEVER be called from inside the settlement transaction — locking `VolunteerTrip` after already holding `Payment` reverses this codebase's established lock order and reintroduces a real deadlock class.
- The auto-refund amount is the full Payment gross (`payment.amount`) — not the tiered `tripFeeRefundAmount` rule (that only applies to a Volunteer voluntarily cancelling an already-`CONFIRMED` Registration close to departure; this is a different scenario: money arriving after an already-decided cancellation, mirroring the Batch-cancellation path's own unconditional full refund).
- `requestedById` on the auto-created Refund is the Registration's own `volunteerId` — there is no admin actor in this flow, and this mirrors how the existing self-cancel route already attributes its own Refund creation to the cancelling Volunteer.
- `reason` on the auto-created Refund must say plainly this was a system-detected settlement-after-cancellation, not a generic string.
- A failure while creating the auto-refund (any thrown error) must be caught, logged with `console.error` naming the payment and registration ids, and must NOT throw — the webhook must still return 200 to the provider, since the underlying settlement already committed successfully.
- The `failed`/`expired` webhook branch is unaffected — this plan only concerns the `paid` branch.
- Reconcile's new `pendingRefunds` array is ONE combined array (every `REQUESTED` Refund, Campaign-or-Trip both), not Campaign/Trip-split siblings like the existing escrow checks — an approval work queue has no reason to be partitioned by subject type.
- Out of scope, do not build: any change to the "hold merely expired" case's existing behavior; any donor/Volunteer-facing notification about the auto-created Refund (no Refund notification of any kind exists anywhere in this codebase yet); any UI or new route for listing/approving pending Refunds beyond the existing `PATCH /api/campaigns/[slug]/refunds/[id]/approve`; voiding/cancelling the underlying Payment when a `HOLD` Registration is cancelled; any change to `createRefund`/`approveRefund`'s own signatures or locking discipline.

---

### Task 1: Webhook auto-refunds a Payment that settled after its Registration was cancelled

**Files:**
- Modify: `src/app/api/webhooks/[provider]/route.ts`
- Modify: `src/app/api/webhooks/[provider]/route.test.ts`

**Interfaces:**
- Consumes: `createRefund(tx, { subject, paymentId, amount, reason, requestedById }): Promise<Refund>`, already exported from `src/lib/money/refunds.ts` — do not modify it. `LedgerSubject` type from `src/lib/money/ledger.ts` (already imported transitively where needed; add `import { createRefund } from '@/lib/money/refunds';` and `import type { LedgerSubject } from '@/lib/money/ledger';` if not already present in this file — check first, the file currently has no import from `refunds.ts`).
- Produces: nothing consumed by Task 2 — the two tasks touch unrelated files.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `POST /api/webhooks/[provider]` (the exported route handler), diimpor dan dipanggil langsung dengan `@/lib/prisma` di-mock, persis pola yang sudah dipakai file test ini sendiri. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: Registration ditemukan CANCELLED (refund otomatis dibuat dengan argumen persis benar), Registration ditemukan EXPIRED (perilaku lama tidak berubah, TIDAK memicu refund — test regresi eksplisit), dan `createRefund` melempar error (webhook tetap menjawab 200, tetap logging, tidak throw). Mock `createRefund` di level modul (`vi.mock('@/lib/money/refunds', ...)`) daripada membangun ulang seluruh mesin transaksi internal `createRefund` di file test ini — file test `src/lib/money/refunds.test.ts` sudah membuktikan kebenaran `createRefund` sendiri secara langsung; tanggung jawab test ini hanya membuktikan webhook memanggilnya dengan benar dan menangani kegagalannya dengan benar.

- [ ] **Step 1: Read the current test file's helpers in full**

Read `src/app/api/webhooks/[provider]/route.test.ts` completely before editing — in particular `makeTx()` (around line 77), `makeRegistrationPayment()` (around line 121), and the existing test `'paid: still posts the ledger legs and settles the Payment when the Registration is no longer HOLD (hold already expired), but does not notify the Volunteer'` (around line 627). This plan's new tests extend both of these rather than inventing new fixtures.

- [ ] **Step 2: Add the module mock for `createRefund` and extend `makeTx`**

At the top of `src/app/api/webhooks/[provider]/route.test.ts`, alongside the existing `vi.mock('@/lib/payments', ...)` block, add:

```typescript
vi.mock('@/lib/money/refunds', () => ({
  createRefund: vi.fn(),
}));
```

Alongside the existing `import { prisma } from '@/lib/prisma';` and other imports near the top, add:

```typescript
import { createRefund } from '@/lib/money/refunds';

const mockCreateRefund = createRefund as unknown as Mock;
```

In `beforeEach`, alongside the existing `mockNotificationCreate.mockResolvedValue({});` line, add:

```typescript
mockCreateRefund.mockResolvedValue({ id: 'refund-1', status: 'REQUESTED' });
```

Extend `makeTx` (currently `function makeTx(options: { paymentUpdateManyCount?: number; registrationUpdateManyCount?: number } = {}) { const { paymentUpdateManyCount = 1, registrationUpdateManyCount = 1 } = options; ...`) to accept and use a third option, defaulting to `'EXPIRED'` so every EXISTING test that does not pass this option keeps its current, unchanged meaning (a Registration found in some non-`HOLD`, non-`CANCELLED` state):

```typescript
function makeTx(options: { paymentUpdateManyCount?: number; registrationUpdateManyCount?: number; registrationCurrentStatus?: string } = {}) {
  const { paymentUpdateManyCount = 1, registrationUpdateManyCount = 1, registrationCurrentStatus = 'EXPIRED' } = options;
  const ledgerRows: LedgerRow[] = [];
  const tx = {
    payment: { updateMany: vi.fn().mockResolvedValue({ count: paymentUpdateManyCount }) },
    donation: { update: vi.fn().mockResolvedValue({}) },
    campaign: { update: vi.fn().mockResolvedValue({}) },
    registration: {
      updateMany: vi.fn().mockResolvedValue({ count: registrationUpdateManyCount }),
      findUnique: vi.fn().mockResolvedValue({ status: registrationCurrentStatus }),
    },
    webhookEvent: { update: vi.fn().mockResolvedValue({}) },
    ledgerEntry: {
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        ledgerRows.push(...data);
        return { count: data.length };
      }),
    },
  };
  return { tx, ledgerRows };
}
```

(Only the `registration` field's shape changed — `updateMany` unchanged, `findUnique` newly added. Everything else in this function is copied verbatim from the current file; do not otherwise restructure it.)

- [ ] **Step 3: Write the three new failing tests**

Add these inside the existing `describe('POST /api/webhooks/[provider] -- registration-linked (Trip Fee) payment', ...)` block, after the existing `'paid: still posts the ledger legs and settles the Payment when the Registration is no longer HOLD (hold already expired), but does not notify the Volunteer'` test:

```typescript
  it('paid: automatically refunds the Payment when the Registration was cancelled before the charge cleared', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue(REGISTRATION_PAID_EVENT),
    });
    mockPaymentFindUnique.mockResolvedValue(makeRegistrationPayment());
    const { tx, ledgerRows } = makeTx({ registrationUpdateManyCount: 0, registrationCurrentStatus: 'CANCELLED' });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    // The money genuinely arrived -- settlement and the ledger legs still
    // post, exactly as the "hold already expired" case already proves.
    expect(ledgerRows.some((r) => r.account === 'TRIP_BALANCE' || r.account === 'ESCROW_HOLD')).toBe(true);
    // No false-success notification -- there is no seat.
    expect(mockNotificationCreate).not.toHaveBeenCalled();
    // The auto-refund, called after the settlement transaction commits, for
    // the full Gross amount, attributed to the cancelling Volunteer.
    expect(mockCreateRefund).toHaveBeenCalledTimes(1);
    expect(mockCreateRefund).toHaveBeenCalledWith(
      expect.anything(),
      {
        subject: { type: 'trip', tripId: 'trip-1' },
        paymentId: 'payment-1',
        amount: 250_000,
        reason: 'Trip Fee settlement arrived after the Registration was already cancelled -- refunded automatically',
        requestedById: 'volunteer-1',
      },
    );
  });

  it('paid: does not attempt an auto-refund when the Registration is EXPIRED rather than CANCELLED', async () => {
    // Regression guard: the naturally-expired case (ticket 03) must keep its
    // existing log-only behavior, unchanged by this fix.
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue(REGISTRATION_PAID_EVENT),
    });
    mockPaymentFindUnique.mockResolvedValue(makeRegistrationPayment());
    const { tx } = makeTx({ registrationUpdateManyCount: 0, registrationCurrentStatus: 'EXPIRED' });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('paid: logs and still answers 200 when the automatic refund creation itself fails', async () => {
    mockGetPaymentProvider.mockReturnValue({
      parseWebhook: vi.fn().mockResolvedValue(REGISTRATION_PAID_EVENT),
    });
    mockPaymentFindUnique.mockResolvedValue(makeRegistrationPayment());
    const { tx } = makeTx({ registrationUpdateManyCount: 0, registrationCurrentStatus: 'CANCELLED' });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    mockCreateRefund.mockRejectedValue(new Error('database exploded'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed to auto-refund payment payment-1'),
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/webhooks/\[provider\]/route.test.ts`
Expected: the 3 new tests FAIL (`mockCreateRefund` is never called, since the route doesn't yet read the Registration's current status or call `createRefund` at all). Every existing test still PASSES (the `registrationCurrentStatus` default of `'EXPIRED'` on the extended `makeTx` doesn't change any existing test's behavior, since none of them read that field yet).

- [ ] **Step 5: Implement the webhook change**

In `src/app/api/webhooks/[provider]/route.ts`, add the import:

```typescript
import { createRefund } from '@/lib/money/refunds';
```

Inside the settlement transaction, in the `if (isTripPayment) { ... }` block, change:

```typescript
        let registrationConfirmed = true;

        if (isTripPayment) {
          const { registration } = payment;
          const registrationUpdate = await tx.registration.updateMany({
            where: { id: registration!.id, status: 'HOLD' },
            data: { status: 'CONFIRMED' },
          });
          registrationConfirmed = registrationUpdate.count > 0;

          if (!registrationConfirmed) {
            console.error(
              `[webhooks/${providerParam}] event ${event.providerEventId} settled payment ${payment.id} for registration ${registration!.id}, but the Registration was no longer HOLD (hold likely already expired) -- money collected, no seat confirmed, needs manual review`,
            );
          }
```

to:

```typescript
        let registrationConfirmed = true;
        let cancelledRegistration: { id: string; volunteerId: string; tripId: string; paymentId: string; amount: number } | null = null;

        if (isTripPayment) {
          const { registration } = payment;
          const registrationUpdate = await tx.registration.updateMany({
            where: { id: registration!.id, status: 'HOLD' },
            data: { status: 'CONFIRMED' },
          });
          registrationConfirmed = registrationUpdate.count > 0;

          if (!registrationConfirmed) {
            console.error(
              `[webhooks/${providerParam}] event ${event.providerEventId} settled payment ${payment.id} for registration ${registration!.id}, but the Registration was no longer HOLD (hold likely already expired) -- money collected, no seat confirmed, needs manual review`,
            );

            // The Registration's own volunteerId/tripId are already known
            // from the Payment fetched before this transaction opened --
            // they never change. Only its status can have moved concurrently,
            // which is exactly what we're re-checking here: distinguishing a
            // deliberate cancellation (auto-refund it) from a naturally
            // expired hold (still an open product question, left alone).
            const current = await tx.registration.findUnique({
              where: { id: registration!.id },
              select: { status: true },
            });
            if (current?.status === 'CANCELLED') {
              cancelledRegistration = {
                id: registration!.id,
                volunteerId: registration!.volunteerId,
                tripId: registration!.batch.tripId,
                paymentId: payment.id,
                amount: payment.amount,
              };
            }
          }
```

Change the transaction's final return statement from:

```typescript
        return { settled: true as const, registrationConfirmed };
```

to:

```typescript
        return { settled: true as const, registrationConfirmed, cancelledRegistration };
```

After the transaction, change:

```typescript
      if (settled.settled) {
        if (isTripPayment) {
          if (settled.registrationConfirmed) {
            const { registration } = payment;
            await notifyRegistrationConfirmed({
              volunteerId: registration!.volunteerId,
              tripSlug: registration!.batch.trip.slug,
              tripTitle: registration!.batch.trip.title,
              amount: payment.amount,
            });
          }
        } else {
```

to:

```typescript
      if (settled.settled) {
        if (isTripPayment) {
          if (settled.registrationConfirmed) {
            const { registration } = payment;
            await notifyRegistrationConfirmed({
              volunteerId: registration!.volunteerId,
              tripSlug: registration!.batch.trip.slug,
              tripTitle: registration!.batch.trip.title,
              amount: payment.amount,
            });
          } else if (settled.cancelledRegistration) {
            // A fresh, separate transaction -- never the settlement's own
            // `tx`. createRefund locks VolunteerTrip-then-Payment; the
            // settlement transaction above has already written Payment, so
            // calling createRefund from inside it would lock in the reverse
            // of this codebase's established Campaign/VolunteerTrip-then-
            // Payment order and reintroduce a real deadlock class (see
            // src/lib/money/escrow.ts's own lock-ordering comment). Failure
            // here is caught, not thrown: the settlement already committed
            // and this webhook must still answer 200 to the provider.
            try {
              const cr = settled.cancelledRegistration;
              await prisma.$transaction((tx2) =>
                createRefund(tx2, {
                  subject: { type: 'trip', tripId: cr.tripId },
                  paymentId: cr.paymentId,
                  amount: cr.amount,
                  reason: 'Trip Fee settlement arrived after the Registration was already cancelled -- refunded automatically',
                  requestedById: cr.volunteerId,
                }),
              );
            } catch (err) {
              console.error(
                `[webhooks/${providerParam}] event ${event.providerEventId}: failed to auto-refund payment ${settled.cancelledRegistration.paymentId} for cancelled registration ${settled.cancelledRegistration.id}`,
                err,
              );
            }
          }
        } else {
```

Everything else in the file (the `catch` around the whole handler, the `failed`/`expired` branch, the Campaign path) is unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/webhooks/\[provider\]/route.test.ts`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 7: Run the full suite once**

Run: `npx vitest run`
Expected: PASS, 0 failures, no regressions in any other file.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/webhooks/\[provider\]/route.ts src/app/api/webhooks/\[provider\]/route.test.ts
git commit -m "fix: auto-refund a Trip Fee settlement that arrives after its Registration was cancelled

The settlement webhook already detected a Registration no longer being HOLD
by the time its Payment settled, but treated a deliberate cancellation
identically to a naturally expired hold: log only, no refund. A Volunteer
who explicitly cancels now gets a full-Gross Refund created automatically
once their independently-clearing charge settles, in a transaction separate
from the settlement itself to avoid reversing this codebase's established
VolunteerTrip-then-Payment lock order.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```

---

### Task 2: Reconcile surfaces every REQUESTED Refund awaiting approval

**Files:**
- Modify: `src/app/api/admin/reconcile/route.ts`
- Modify: `src/app/api/admin/reconcile/route.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 — independent files, no shared interface. Consumes the existing `Refund` model's fields (`id`, `paymentId`, `amount`, `reason`, `requestedById`, `createdAt`, `status`) and the existing `Payment.donationId`/`registrationId`/`donation`/`registration` subject-resolution shape already used by `strandedEscrow` in this same file.
- Produces: `pendingRefunds: Array<{ refundId: string; paymentId: string; amount: number; reason: string; requestedById: string; createdAt: Date; campaignId: string | null; volunteerTripId: string | null }>` in the route's returned report object. Nothing else in this plan consumes it.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `GET /api/admin/reconcile` (the exported route handler), diimpor dan dipanggil langsung dengan `@/lib/prisma` di-mock, persis pola yang sudah dipakai file test ini sendiri. Cakup SETIAP kondisi MELALUI seam itu: Refund berstatus REQUESTED yang terkait Campaign muncul di `pendingRefunds` dengan `campaignId` terisi dan `volunteerTripId` null; Refund berstatus REQUESTED yang terkait Trip muncul dengan `volunteerTripId` terisi dan `campaignId` null; Refund berstatus selain REQUESTED (APPROVED, REJECTED) tidak muncul sama sekali; tidak ada Refund REQUESTED sama sekali menghasilkan array kosong, bukan field yang hilang dari respons.

- [ ] **Step 1: Read the current test file's fixture helpers in full**

Read `src/app/api/admin/reconcile/route.test.ts` completely before editing — in particular the `RefundRow` type and `makeTx`'s `refund.findMany`/`payment.findMany` mocks (both around lines 60-183). This plan's changes extend the existing `RefundRow` type and the existing `refund.findMany` mock's return shape; they do not replace either.

- [ ] **Step 2: Write the four failing tests**

Extend the `RefundRow` type (currently `type RefundRow = { id: string; paymentId: string; status?: string };`) to:

```typescript
type RefundRow = {
  id: string;
  paymentId: string;
  status?: string;
  amount?: number;
  reason?: string;
  requestedById?: string;
  createdAt?: Date;
};
```

Replace the existing `refund: { findMany: ... }` mock inside `makeTx` (currently returning only `{ id: r.id, paymentId: r.paymentId }` per row) with a version that also resolves each refund's subject, mirroring the exact same `isTrip`/`isCampaign` derivation `payment.findMany`'s own mock already uses two blocks above it in this same function:

```typescript
    refund: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        refunds
          .filter((r) => matchesWhere(r as never as Record<string, unknown>, where))
          .map((r) => {
            const payment = payments.find((p) => p.id === r.paymentId);
            const isTrip = payment?.volunteerTripId != null;
            const isCampaign = payment?.campaignId != null;
            return {
              id: r.id,
              paymentId: r.paymentId,
              amount: r.amount ?? 0,
              reason: r.reason ?? 'Test refund reason',
              requestedById: r.requestedById ?? 'requester-1',
              createdAt: r.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
              payment: payment
                ? {
                    donationId: isCampaign ? `donation-for-${payment.id}` : null,
                    registrationId: isTrip ? `registration-for-${payment.id}` : null,
                    donation: isCampaign ? { campaignId: payment.campaignId } : null,
                    registration: isTrip ? { batch: { tripId: payment.volunteerTripId } } : null,
                  }
                : null,
            };
          }),
      ),
    },
```

(This is backward compatible with every EXISTING call site of this mock — the `strandedEscrow`/`deferredEscrowWatchdog` machinery only ever reads `.id`/`.paymentId` off these rows; the extra fields are additive and harmless. Do not change `matchesWhere` itself — it already generically supports `{ status: 'REQUESTED' }` as a `where` clause with no modification needed.)

Add these tests inside the existing `describe('GET /api/admin/reconcile', ...)` block:

```typescript
  it('lists a Campaign-linked REQUESTED refund in pendingRefunds', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1', status: 'REQUESTED', amount: 50_000, reason: 'Donor overpaid', requestedById: 'admin-1', createdAt: new Date('2026-02-01T00:00:00.000Z') }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingRefunds).toEqual([
      {
        refundId: 'refund-1',
        paymentId: 'payment-1',
        amount: 50_000,
        reason: 'Donor overpaid',
        requestedById: 'admin-1',
        createdAt: '2026-02-01T00:00:00.000Z',
        campaignId: 'campaign-1',
        volunteerTripId: null,
      },
    ]);
  });

  it('lists a Trip-linked REQUESTED refund in pendingRefunds', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-2', volunteerTripId: 'trip-1' }],
      refunds: [{ id: 'refund-2', paymentId: 'payment-2', status: 'REQUESTED', amount: 250_000, reason: 'Registration cancelled', requestedById: 'volunteer-1', createdAt: new Date('2026-02-02T00:00:00.000Z') }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingRefunds).toEqual([
      {
        refundId: 'refund-2',
        paymentId: 'payment-2',
        amount: 250_000,
        reason: 'Registration cancelled',
        requestedById: 'volunteer-1',
        createdAt: '2026-02-02T00:00:00.000Z',
        campaignId: null,
        volunteerTripId: 'trip-1',
      },
    ]);
  });

  it('excludes a Refund that is not REQUESTED from pendingRefunds', async () => {
    const tx = makeTx({
      payments: [{ id: 'payment-3', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-3', paymentId: 'payment-3', status: 'APPROVED', amount: 10_000 }],
    });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingRefunds).toEqual([]);
  });

  it('returns an empty pendingRefunds array, not an absent field, when there are no pending refunds', async () => {
    const tx = makeTx({});
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.pendingRefunds).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/admin/reconcile/route.test.ts`
Expected: the 4 new tests FAIL (`pendingRefunds` is `undefined` on the response body). Every existing test still PASSES (the extended `refund.findMany` mock's added fields don't change any existing assertion, since none of them read those fields).

- [ ] **Step 4: Implement the reconcile change**

In `src/app/api/admin/reconcile/route.ts`, after the existing `deferredEscrowCandidates`/`tripDeferredEscrowWatchdog` block and before the `processingPayouts`/`approvedWithoutProviderRef` block, add:

```typescript
    // Every REQUESTED Refund, Campaign-or-Trip both, in one combined list --
    // an approval work queue has no reason to be split by subject the way a
    // balance check does. Nothing else in this codebase currently makes a
    // REQUESTED Refund discoverable after it's created; this is the only
    // place an Admin can find one to act on.
    const pendingRefundRows = await tx.refund.findMany({
      where: { status: 'REQUESTED' },
      select: {
        id: true,
        paymentId: true,
        amount: true,
        reason: true,
        requestedById: true,
        createdAt: true,
        payment: {
          select: {
            donationId: true,
            registrationId: true,
            donation: { select: { campaignId: true } },
            registration: { select: { batch: { select: { tripId: true } } } },
          },
        },
      },
    });

    const pendingRefunds = pendingRefundRows.map((r) => ({
      refundId: r.id,
      paymentId: r.paymentId,
      amount: r.amount,
      reason: r.reason,
      requestedById: r.requestedById,
      createdAt: r.createdAt,
      campaignId: r.payment?.donationId != null ? r.payment.donation!.campaignId : null,
      volunteerTripId: r.payment?.registrationId != null ? r.payment.registration!.batch.tripId : null,
    }));
```

Add `pendingRefunds,` to the object returned at the end of the route (the `return { generatedAt: ..., ... }` block), placed after `subjectlessPayments,` and before `stuckPayouts: { ... }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/admin/reconcile/route.test.ts`
Expected: PASS, all tests including the 4 new ones.

- [ ] **Step 6: Run the full suite once, and confirm no new `tsc --noEmit` errors**

Run: `npx vitest run`
Expected: PASS, 0 failures.

Run: `npx tsc --noEmit`. This plan touches two files with no known pre-existing type gaps of the class earlier Volunteer Trip tickets found (unguarded `payment.donation`-style assumptions) — report the total error count before and after this task's own changes; it should be unchanged, since this task only adds new, fully-typed code.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/reconcile/route.ts src/app/api/admin/reconcile/route.test.ts
git commit -m "feat: reconcile report lists every REQUESTED Refund awaiting approval

No Refund, whether created by an Admin or (as of the settlement-webhook fix)
automatically by the platform, has ever been discoverable after creation --
nothing lists pending Refunds anywhere. pendingRefunds closes that: one
combined Campaign-or-Trip array, since an approval work queue has no reason
to split by subject the way a balance check does.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```
