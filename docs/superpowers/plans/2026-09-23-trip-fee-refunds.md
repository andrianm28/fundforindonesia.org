# Trip Fee Refunds and Batch Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Volunteer can cancel their own CONFIRMED Registration for a tiered partial refund, and a Fundraiser can cancel an under-quota Batch to trigger a full refund for every CONFIRMED Registration on it, both sharing the same underlying, already-generalized Refund machinery.

**Architecture:** A new pure function `tripFeeRefundAmount` computes the tiered-by-time-to-departure refund amount. A new Volunteer-facing registration-cancel route and an extended Fundraiser batch-cancel action both call the already-shipped, Campaign-or-Trip-generalized `createRefund` (`src/lib/money/refunds.ts`) to freeze funds from `ESCROW_HOLD` or `TRIP_BALANCE`. No schema change and no money-layer change: `Registration`, `VolunteerBatch`, `Refund`, and `LedgerAccount.TRIP_BALANCE` already have every field and every leg-builder this needs.

**Tech Stack:** Next.js App Router API routes, Prisma, Zod, Vitest — matching the rest of this codebase.

**Spec:** `.scratch/volunteer-trip/issues/05-trip-fee-refunds-and-batch-cancellation.md`

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    ${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/specflow}/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-23-trip-fee-refunds.md /home/ubuntu/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief
    ${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/specflow}/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-23-trip-fee-refunds.md /home/ubuntu/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- New pure function `tripFeeRefundAmount({ departureDate, now, paidAmount })` computes the tiered-by-time-to-departure refund amount for a Volunteer-initiated cancellation. Thresholds are this ticket's own documented default, not pinned by any upstream spec: >= 14 days before departure -> 100% refund; 3-13 days before departure (inclusive of 3, exclusive of 14) -> 50% refund; < 3 days before departure, including on/after departure -> 0% refund. Round down (floor) any fractional Rupiah, never refunding more than the exact percentage of `paidAmount`.
- A Volunteer can trigger cancellation of their own CONFIRMED Registration, creating a Refund for the Trip Fee Payment sized by `tripFeeRefundAmount`, sourced from `ESCROW_HOLD` or `TRIP_BALANCE` depending on whether this Payment's escrow has already matured, via the existing generalized `createRefund` (`src/lib/money/refunds.ts`) -- mirroring exactly how Campaign refunds already choose their source. Do not reimplement source selection; `createRefund` already does it.
- If `tripFeeRefundAmount` computes 0 for a Volunteer's own CONFIRMED-Registration cancellation, no Refund is created -- the Registration is simply cancelled, mirroring the "nothing to refund" rule for a HOLD cancellation below.
- A Volunteer cancelling a Registration that is only HOLD (never paid) simply cancels it (-> CANCELLED) with no Refund created -- there's nothing to refund.
- Decision (route shape, not pinned by the spec): the Volunteer's own-Registration cancel action is `PATCH /api/registrations/[id]`, a new route, authorized by `session.user.id === registration.volunteerId` -- no Role/Assignment check, matching how `POST .../registrations` itself requires no special role beyond being signed in.
- A Fundraiser can cancel a Batch whose CONFIRMED count is below its `minQuota`, at any time while the Batch is OPEN -- `registrationDeadline` is never a lower bound on when this is allowed, only the point after which it becomes a live possibility to check for. This is the cancel action of `PATCH /api/volunteer-trips/[slug]/batches/[id]` intentionally left out of Ticket 02.
- Fundraiser-cancelling a Batch: the Batch moves to CANCELLED, every CONFIRMED Registration on it moves to CANCELLED, and each gets a Refund for the full Trip Fee paid via `createRefund`, regardless of `tripFeeRefundAmount`'s tiered output -- a different, simpler rule (100%, always), never `tripFeeRefundAmount` called with a departure date far in the future.
- Both paths call the existing generalized `createRefund` (`src/lib/money/refunds.ts`) -- its `source` selection already includes `TRIP_BALANCE` alongside `ESCROW_HOLD`/`CAMPAIGN_BALANCE`, and `refundRequestedLegs`/`refundApprovedLegs` (`src/lib/money/ledger.ts`) are already generalized over `subject`. Do not modify the money layer (`src/lib/money/*`) in this plan -- it is already fully generalized and independently tested (see `src/lib/money/refunds.test.ts`'s existing Trip-subject coverage) for exactly this use.
- Decision (approval-cycle shape, explicitly left open by the parent spec's Further Notes): this ticket creates Refunds at REQUESTED only, for both the Volunteer-cancel and Fundraiser-batch-cancel paths -- it does NOT add a Trip-scoped analogue of the existing `POST /api/campaigns/[slug]/refunds/[id]/approve`. Approving/settling a Trip-subject Refund is left to a future ticket. This keeps the codebase's existing two-person, no-shortcuts money-movement discipline intact (self-approval is blocked by `approveRefund` itself) rather than inventing a system-actor bypass to auto-approve. Do not build an approve route in this plan.
- Out of scope, carried from the parent spec (`.scratch/volunteer-trip/spec.md`): do not touch or extend `src/lib/money/refunds.ts`'s create/approve API shape itself, and do not add `volunteer` as a Campaign Kind. No schema migration -- `Registration`, `VolunteerBatch`, `Refund`, and `LedgerAccount.TRIP_BALANCE` already have every field this ticket needs.
- Regression test: a Fundraiser cannot cancel a Batch that already met its `minQuota`.
- Regression test: a Fundraiser-cancelled Batch's refunds are never reduced by `tripFeeRefundAmount`'s tiering, however close to departure the cancellation happens.
- Regression test: a Volunteer cannot trigger the full-refund-regardless-of-timing path by cancelling their own Registration -- only a genuine Fundraiser Batch cancellation gets it.

## Review Focus

- Ownership: a Volunteer must never be able to cancel (and trigger a Refund for) someone else's Registration. Pinned in Task 2.
- A concurrent double-cancel on the same Registration (two near-simultaneous requests) must not create two Refunds for the same Payment -- the status transition must be claimed with a predicate-based update before any Refund is created. Pinned in Task 2.
- Cancelling a Batch that is not OPEN (already CLOSED, CANCELLED, or COMPLETED) must be refused, not just gated on `minQuota` -- a reasonable Fundraiser expects "cancel" to only ever apply once. Pinned in Task 3.
- `tripFeeRefundAmount`'s exact boundary days (14 days, 3 days, and on/after departure) must each land in the tier a reasonable Volunteer expects from the documented contract, not an off-by-one from imprecise date math. Pinned in Task 1.
- A Fundraiser-cancelled Batch's refund must stay the full Trip Fee even when departure is imminent, while a Volunteer's own self-cancel in that same window gets nothing -- proving the two refund code paths (tiered vs. always-full) are genuinely separate, not the same function called with different inputs. Pinned jointly in Task 2 (self-cancel side) and Task 3 (Batch-cancel side).

---

### Task 1: `tripFeeRefundAmount` -- the tiered-by-time-to-departure refund rule

**Files:**
- Create: `src/lib/volunteer/refunds.ts`
- Create: `src/lib/volunteer/refunds.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `tripFeeRefundAmount(params: { departureDate: Date; now: Date; paidAmount: number }): number` (`src/lib/volunteer/refunds.ts`) -- consumed by Task 2.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `tripFeeRefundAmount` (`src/lib/volunteer/refunds.ts`), fungsi murni yang dipanggil langsung dengan nilai `departureDate`/`now`/`paidAmount` eksplisit -- tidak pernah lewat clock yang di-mock atau lewat route. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: kedua batas hari (14 hari, 3 hari) persis di titiknya dan persis satu milidetik di luarnya, tanggal keberangkatan yang sudah lewat, dan pembulatan ke bawah untuk `paidAmount` ganjil pada tier 50%. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/volunteer/refunds.test.ts
import { describe, it, expect } from 'vitest';
import { tripFeeRefundAmount } from './refunds';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-01T00:00:00.000Z');

function departureDaysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

describe('tripFeeRefundAmount', () => {
  it('refunds in full at exactly 14 days before departure', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(14), now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(100_000);
  });

  it('refunds in full further than 14 days before departure', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(60), now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(100_000);
  });

  it('refunds half just under 14 days before departure', () => {
    const departureDate = new Date(departureDaysFromNow(14).getTime() - 1);
    const amount = tripFeeRefundAmount({ departureDate, now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(50_000);
  });

  it('refunds half at exactly 3 days before departure', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(3), now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(50_000);
  });

  it('rounds a half-refund down to the nearest Rupiah', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(3), now: NOW, paidAmount: 100_001 });
    expect(amount).toBe(50_000);
  });

  it('refunds nothing just under 3 days before departure', () => {
    const departureDate = new Date(departureDaysFromNow(3).getTime() - 1);
    const amount = tripFeeRefundAmount({ departureDate, now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(0);
  });

  it('refunds nothing on the departure date itself', () => {
    const amount = tripFeeRefundAmount({ departureDate: NOW, now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(0);
  });

  it('refunds nothing after departure has already passed', () => {
    const amount = tripFeeRefundAmount({ departureDate: departureDaysFromNow(-5), now: NOW, paidAmount: 100_000 });
    expect(amount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/volunteer/refunds.test.ts`
Expected: FAIL with "Cannot find module './refunds'" (the file doesn't exist yet).

- [ ] **Step 3: Implement `tripFeeRefundAmount`**

```typescript
// src/lib/volunteer/refunds.ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The tiered-by-time-to-departure refund amount for a Volunteer-initiated
 * cancellation of their own CONFIRMED Registration. Thresholds and
 * percentages are this function's own contract -- no upstream spec pins
 * them down (see .scratch/volunteer-trip/spec.md's "Trip Fee refund rule"
 * and Further Notes): >= 14 days before departure refunds in full; 3-13
 * days before departure refunds half; inside 3 days of departure, or on/
 * after departure itself, refunds nothing.
 *
 * A Fundraiser-cancelled Batch (100% refund regardless of timing) is a
 * DIFFERENT, simpler rule and never calls this function -- see the
 * Batch-cancel route (Task 3) instead.
 *
 * Rounds down: a fractional Rupiah never rounds in the Volunteer's favor,
 * so the refund never exceeds paidAmount * the tier's percentage.
 */
export function tripFeeRefundAmount(params: {
  departureDate: Date;
  now: Date;
  paidAmount: number;
}): number {
  const { departureDate, now, paidAmount } = params;
  const daysToDeparture = Math.floor((departureDate.getTime() - now.getTime()) / MS_PER_DAY);

  if (daysToDeparture >= 14) return paidAmount;
  if (daysToDeparture >= 3) return Math.floor(paidAmount / 2);
  return 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/volunteer/refunds.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/volunteer/refunds.ts src/lib/volunteer/refunds.test.ts
git commit -m "feat: add tripFeeRefundAmount, the tiered Volunteer-cancellation refund rule"
```

---

### Task 2: `PATCH /api/registrations/[id]` -- a Volunteer cancels their own Registration

**Files:**
- Create: `src/app/api/registrations/[id]/route.ts`
- Create: `src/app/api/registrations/[id]/route.test.ts`

**Interfaces:**
- Consumes: `tripFeeRefundAmount` (Task 1, `@/lib/volunteer/refunds`); `createRefund`, `PaymentNotFoundError`, `PaymentSubjectMismatchError`, `RefundExceedsRemainingError` (existing, `@/lib/money/refunds`); `prisma` (existing, `@/lib/prisma`); `getServerSession` (existing, `@/lib/auth`).
- Produces: `PATCH /api/registrations/[id]` -- no other task consumes this directly.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler yang diekspor (`PATCH`, `src/app/api/registrations/[id]/route.ts`), diimpor dan dipanggil langsung dengan `@/lib/prisma`, `@/lib/auth`, dan `@/lib/money/refunds` di-mock, persis gaya `src/app/api/campaigns/[slug]/refunds/route.test.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: gating kepemilikan (401 tanpa sesi, 403 milik Volunteer lain), status Registrasi yang tidak bisa dibatalkan (EXPIRED, sudah CANCELLED), jalur HOLD tanpa Refund, ketiga tier `tripFeeRefundAmount` (penuh, setengah, nol) lewat pemanggilan nyata terhadap fungsi Task 1 -- bukan di-mock -- dengan tanggal relatif terhadap waktu nyata, race pembatalan ganda (`updateMany` mengembalikan `count: 0` → 409, `createRefund` tidak pernah dipanggil), dan pemetaan kode status untuk error yang dilempar `createRefund`. Helper internal (`tripFeeRefundAmount`) diuji secara tidak langsung lewat seam ini di sini, terpisah dari pengujian langsungnya sendiri di Task 1. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/registrations/[id]/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registration: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/money/refunds', () => ({
  createRefund: vi.fn(),
  PaymentNotFoundError: class PaymentNotFoundError extends Error {},
  PaymentSubjectMismatchError: class PaymentSubjectMismatchError extends Error {},
  RefundExceedsRemainingError: class RefundExceedsRemainingError extends Error {},
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { createRefund, PaymentSubjectMismatchError } from '@/lib/money/refunds';
import { PATCH } from './route';

const mockFindUnique = prisma.registration.findUnique as unknown as Mock;
const mockUpdateMany = prisma.registration.updateMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockCreateRefund = createRefund as unknown as Mock;

function patchRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/registrations/reg-1', { method: 'PATCH' });
}

function routeContext(id = 'reg-1') {
  return { params: Promise.resolve({ id }) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function registrationFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reg-1',
    volunteerId: 'volunteer-1',
    status: 'CONFIRMED',
    batch: { tripId: 'trip-1', startDate: new Date(Date.now() + 20 * DAY_MS) },
    payment: { id: 'payment-1', amount: 100_000 },
    ...overrides,
  };
}

describe('PATCH /api/registrations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'volunteer-1' } });
    mockFindUnique.mockResolvedValue(registrationFixture());
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({ registration: { updateMany: mockUpdateMany } }),
    );
    mockCreateRefund.mockResolvedValue({ id: 'refund-1', amount: 100_000, status: 'REQUESTED' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the registration does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 403 when the Registration belongs to a different Volunteer', async () => {
    mockFindUnique.mockResolvedValue(registrationFixture({ volunteerId: 'someone-else' }));
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 for a Registration that is already CANCELLED', async () => {
    mockFindUnique.mockResolvedValue(registrationFixture({ status: 'CANCELLED' }));
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 for a Registration that is EXPIRED', async () => {
    mockFindUnique.mockResolvedValue(registrationFixture({ status: 'EXPIRED' }));
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('cancels a HOLD Registration with no Refund created', async () => {
    mockFindUnique.mockResolvedValue(registrationFixture({ status: 'HOLD', payment: null }));
    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual({ id: 'reg-1', status: 'CANCELLED', refund: null });
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('cancels a CONFIRMED Registration far from departure with a full Refund', async () => {
    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(mockCreateRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subject: { type: 'trip', tripId: 'trip-1' },
        paymentId: 'payment-1',
        amount: 100_000,
        requestedById: 'volunteer-1',
      }),
    );
    expect(data.refund).toEqual({ id: 'refund-1', amount: 100_000, status: 'REQUESTED' });
  });

  it('cancels a CONFIRMED Registration inside the mid tier with a half Refund', async () => {
    mockFindUnique.mockResolvedValue(
      registrationFixture({ batch: { tripId: 'trip-1', startDate: new Date(Date.now() + 5 * DAY_MS) } }),
    );
    await PATCH(patchRequest(), routeContext());
    expect(mockCreateRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 50_000 }));
  });

  it('cancels a CONFIRMED Registration inside the no-refund window with no Refund created -- proving self-cancel never gets the Batch-cancel full-refund rule', async () => {
    mockFindUnique.mockResolvedValue(
      registrationFixture({ batch: { tripId: 'trip-1', startDate: new Date(Date.now() + DAY_MS) } }),
    );
    const response = await PATCH(patchRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.refund).toBeNull();
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 409, creating no Refund, when the cancel race is lost to a concurrent update', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(409);
    expect(mockCreateRefund).not.toHaveBeenCalled();
  });

  it('returns 500 when createRefund reports the Payment does not match the Trip subject', async () => {
    mockCreateRefund.mockRejectedValue(new PaymentSubjectMismatchError('payment-1'));
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/registrations/[id]/route.test.ts`
Expected: FAIL with "Cannot find module './route'" (the route doesn't exist yet).

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/registrations/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import {
  createRefund,
  PaymentNotFoundError,
  PaymentSubjectMismatchError,
  RefundExceedsRemainingError,
} from '@/lib/money/refunds';
import { tripFeeRefundAmount } from '@/lib/volunteer/refunds';

class RegistrationNotCancellableError extends Error {}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const volunteerId = session.user.id as string;

    const registration = await prisma.registration.findUnique({
      where: { id },
      select: {
        id: true,
        volunteerId: true,
        status: true,
        batch: { select: { tripId: true, startDate: true } },
        payment: { select: { id: true, amount: true } },
      },
    });

    if (!registration) {
      return NextResponse.json({ error: 'Registrasi tidak ditemukan' }, { status: 404 });
    }

    if (registration.volunteerId !== volunteerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (registration.status !== 'HOLD' && registration.status !== 'CONFIRMED') {
      return NextResponse.json({ error: 'Registrasi tidak bisa dibatalkan pada status ini' }, { status: 400 });
    }

    try {
      // The status transition is claimed with a predicate-based update
      // INSIDE the same transaction that (for a CONFIRMED Registration)
      // creates the Refund -- so a concurrent second cancel attempt on
      // this same Registration can't also pass the read above and also
      // create a second Refund, and so a createRefund failure rolls the
      // status change back too rather than leaving a cancelled-but-
      // unrefunded Registration.
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.registration.updateMany({
          where: { id: registration.id, status: registration.status },
          data: { status: 'CANCELLED' },
        });
        if (claimed.count === 0) {
          throw new RegistrationNotCancellableError();
        }

        if (registration.status === 'HOLD') {
          return { refund: null as { id: string; amount: number; status: string } | null };
        }

        // A CONFIRMED Registration is only ever reached once its Payment
        // has settled (see prisma/schema.prisma's own comment on
        // Registration.status) -- payment is guaranteed non-null here.
        const payment = registration.payment!;
        const amount = tripFeeRefundAmount({
          departureDate: registration.batch.startDate,
          now: new Date(),
          paidAmount: payment.amount,
        });

        if (amount === 0) {
          return { refund: null };
        }

        const refund = await createRefund(tx, {
          subject: { type: 'trip', tripId: registration.batch.tripId },
          paymentId: payment.id,
          amount,
          reason: 'Volunteer membatalkan Registrasi',
          requestedById: volunteerId,
        });

        return { refund: { id: refund.id, amount: refund.amount, status: refund.status } };
      });

      return NextResponse.json({
        id: registration.id,
        status: 'CANCELLED',
        refund: result.refund,
      });
    } catch (error) {
      if (error instanceof RegistrationNotCancellableError) {
        return NextResponse.json({ error: 'Registrasi tidak bisa dibatalkan pada status ini' }, { status: 409 });
      }
      if (
        error instanceof PaymentNotFoundError ||
        error instanceof PaymentSubjectMismatchError ||
        error instanceof RefundExceedsRemainingError
      ) {
        console.error('Error cancelling registration -- refund could not be created:', error);
        return NextResponse.json({ error: 'Gagal membuat refund untuk pembatalan ini' }, { status: 500 });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error cancelling registration:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/registrations/[id]/route.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/registrations/[id]/route.ts src/app/api/registrations/[id]/route.test.ts
git commit -m "feat: a Volunteer can cancel their own Registration for a tiered refund"
```

---

### Task 3: Fundraiser cancels an under-quota Batch

**Files:**
- Modify: `src/app/api/volunteer-trips/[slug]/batches/[id]/route.ts`
- Modify: `src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts`

**Interfaces:**
- Consumes: `createRefund` (existing, `@/lib/money/refunds`); `prisma`, `getServerSession`, `isAtLeast`, `Role` (existing, unchanged imports in this file).
- Produces: the cancel action of `PATCH /api/volunteer-trips/[slug]/batches/[id]` (body `{ action: 'cancel' }`) -- no other task consumes this directly.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler yang diekspor (`PATCH`, `src/app/api/volunteer-trips/[slug]/batches/[id]/route.ts`), diimpor dan dipanggil langsung dengan `@/lib/prisma`, `@/lib/auth`, dan `@/lib/money/refunds` di-mock, memperluas suite test edit-action yang sudah ada di berkas ini, bukan menggantinya. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: gating kepemilikan Fundraiser yang sama dengan jalur edit, guard status batch harus OPEN (menolak CLOSED/CANCELLED/COMPLETED), guard `minQuota` sudah tercapai (>=, bukan >), bulk-cancel setiap Registrasi CONFIRMED dan refund penuh untuk masing-masing tanpa memanggil `tripFeeRefundAmount` sama sekali -- termasuk saat keberangkatan sudah sangat dekat, membuktikan jalur ini genuinely terpisah dari jalur tiered Task 2 -- dan Batch tanpa Registrasi CONFIRMED sama sekali (nol refund, batch tetap berpindah ke CANCELLED). Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests -- replace the full contents of the test file**

```typescript
// src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    volunteerBatch: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/money/refunds', () => ({
  createRefund: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { createRefund } from '@/lib/money/refunds';
import { PATCH } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockBatchFindUnique = prisma.volunteerBatch.findUnique as unknown as Mock;
const mockBatchUpdate = prisma.volunteerBatch.update as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockCreateRefund = createRefund as unknown as Mock;

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug/batches/batch-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug', id = 'batch-1') {
  return { params: Promise.resolve({ slug, id }) };
}

function makeCancelTx(
  options: {
    confirmedCount?: number;
    confirmedRegistrations?: Array<{ id: string; payment: { id: string; amount: number } }>;
  } = {},
) {
  const registrationCount = vi.fn().mockResolvedValue(options.confirmedCount ?? 0);
  const registrationFindMany = vi.fn().mockResolvedValue(options.confirmedRegistrations ?? []);
  const registrationUpdateMany = vi.fn().mockResolvedValue({ count: options.confirmedRegistrations?.length ?? 0 });
  const volunteerBatchUpdate = vi.fn().mockResolvedValue({ id: 'batch-1', status: 'CANCELLED' });
  return {
    tx: {
      registration: { count: registrationCount, findMany: registrationFindMany, updateMany: registrationUpdateMany },
      volunteerBatch: { update: volunteerBatchUpdate },
    },
    registrationCount,
    registrationFindMany,
    registrationUpdateMany,
    volunteerBatchUpdate,
  };
}

describe('PATCH /api/volunteer-trips/[slug]/batches/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1' });
    mockBatchFindUnique.mockResolvedValue({
      id: 'batch-1',
      tripId: 'trip-1',
      status: 'OPEN',
      maxQuota: 20,
      minQuota: 8,
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      endDate: new Date('2026-12-05T00:00:00.000Z'),
      registrationDeadline: new Date('2026-11-20T00:00:00.000Z'),
    });
    mockBatchUpdate.mockResolvedValue({ id: 'batch-1', maxQuota: 25 });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(401);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(404);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the batch does not exist, or does not belong to this trip', async () => {
    mockBatchFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(404);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the batch belongs to a different trip than the slug names', async () => {
    mockBatchFindUnique.mockResolvedValue({ id: 'batch-1', tripId: 'a-different-trip', status: 'OPEN' });
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(404);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owning Fundraiser', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(403);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('allows the owning Fundraiser to edit an OPEN batch', async () => {
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(200);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maxQuota: 25 }) }),
    );
  });

  it('returns 400 for editing a CLOSED batch', async () => {
    mockBatchFindUnique.mockResolvedValue({ id: 'batch-1', tripId: 'trip-1', status: 'CLOSED', maxQuota: 20, minQuota: 8 });
    const response = await PATCH(patchRequest({ maxQuota: 25 }), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied status field -- cancelling requires the dedicated action: "cancel" body, not a raw status write', async () => {
    const response = await PATCH(patchRequest({ maxQuota: 25, status: 'CANCELLED' }), routeContext());
    expect(response.status).toBe(200);
    const updateCall = mockBatchUpdate.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it('returns 400 when the edited minQuota would exceed the batch\'s own maxQuota', async () => {
    const response = await PATCH(patchRequest({ minQuota: 30 }), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when the edited endDate is before the stored startDate', async () => {
    const response = await PATCH(
      patchRequest({ endDate: '2026-11-25T00:00:00.000Z' }),
      routeContext(),
    );
    expect(response.status).toBe(400);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when the edited registrationDeadline is after the stored startDate', async () => {
    const response = await PATCH(
      patchRequest({ registrationDeadline: '2026-12-02T00:00:00.000Z' }),
      routeContext(),
    );
    expect(response.status).toBe(400);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  describe('cancel action', () => {
    it('returns 403 for a non-owning Fundraiser attempting to cancel', async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      expect(response.status).toBe(403);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('returns 400 when the batch is not OPEN', async () => {
      mockBatchFindUnique.mockResolvedValue({ id: 'batch-1', tripId: 'trip-1', status: 'CLOSED', maxQuota: 20, minQuota: 8 });
      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      expect(response.status).toBe(400);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('returns 400 when the Batch already met its minQuota', async () => {
      const { tx } = makeCancelTx({ confirmedCount: 8 });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      expect(response.status).toBe(400);
      expect(mockCreateRefund).not.toHaveBeenCalled();
    });

    it('cancels an under-quota Batch, cancels every CONFIRMED Registration, and refunds each in full', async () => {
      const confirmedRegistrations = [
        { id: 'reg-a', payment: { id: 'payment-a', amount: 100_000 } },
        { id: 'reg-b', payment: { id: 'payment-b', amount: 250_000 } },
      ];
      const { tx, volunteerBatchUpdate, registrationUpdateMany } = makeCancelTx({
        confirmedCount: 2,
        confirmedRegistrations,
      });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      mockCreateRefund
        .mockResolvedValueOnce({ id: 'refund-a', amount: 100_000, status: 'REQUESTED' })
        .mockResolvedValueOnce({ id: 'refund-b', amount: 250_000, status: 'REQUESTED' });

      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(volunteerBatchUpdate).toHaveBeenCalledWith({ where: { id: 'batch-1' }, data: { status: 'CANCELLED' } });
      expect(registrationUpdateMany).toHaveBeenCalledWith({
        where: { batchId: 'batch-1', status: 'CONFIRMED' },
        data: { status: 'CANCELLED' },
      });
      expect(mockCreateRefund).toHaveBeenCalledTimes(2);
      expect(mockCreateRefund).toHaveBeenNthCalledWith(1, expect.anything(), {
        subject: { type: 'trip', tripId: 'trip-1' },
        paymentId: 'payment-a',
        amount: 100_000,
        reason: 'Batch dibatalkan karena tidak mencapai kuota minimum',
        requestedById: 'owner-1',
      });
      expect(mockCreateRefund).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ paymentId: 'payment-b', amount: 250_000 }),
      );
      expect(data.refundedRegistrations).toEqual([
        { registrationId: 'reg-a', refundId: 'refund-a', amount: 100_000 },
        { registrationId: 'reg-b', refundId: 'refund-b', amount: 250_000 },
      ]);
    });

    it('refunds the full Trip Fee even when the Batch departs imminently -- never the tiered Volunteer-cancel rule', async () => {
      mockBatchFindUnique.mockResolvedValue({
        id: 'batch-1',
        tripId: 'trip-1',
        status: 'OPEN',
        maxQuota: 20,
        minQuota: 8,
        startDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day out -- inside tripFeeRefundAmount's own 0%-tier window
        endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        registrationDeadline: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const confirmedRegistrations = [{ id: 'reg-a', payment: { id: 'payment-a', amount: 100_000 } }];
      const { tx } = makeCancelTx({ confirmedCount: 1, confirmedRegistrations });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
      mockCreateRefund.mockResolvedValueOnce({ id: 'refund-a', amount: 100_000, status: 'REQUESTED' });

      await PATCH(patchRequest({ action: 'cancel' }), routeContext());

      expect(mockCreateRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 100_000 }));
    });

    it('cancels a Batch with zero CONFIRMED Registrations, creating no Refund', async () => {
      const { tx, volunteerBatchUpdate } = makeCancelTx({ confirmedCount: 0, confirmedRegistrations: [] });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const response = await PATCH(patchRequest({ action: 'cancel' }), routeContext());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(volunteerBatchUpdate).toHaveBeenCalled();
      expect(mockCreateRefund).not.toHaveBeenCalled();
      expect(data.refundedRegistrations).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run "src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts"`
Expected: the pre-existing tests still PASS; the five new tests inside `describe('cancel action', ...)` FAIL, since no `action: 'cancel'` branch exists yet in the route.

- [ ] **Step 3: Implement the cancel action -- replace the full contents of the route file**

```typescript
// src/app/api/volunteer-trips/[slug]/batches/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { Role } from '@/generated/prisma/client';
import { createRefund } from '@/lib/money/refunds';

const editBatchSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  registrationDeadline: z.string().datetime().optional(),
  maxQuota: z.number().int().positive().optional(),
  minQuota: z.number().int().positive().optional(),
});

const cancelActionSchema = z.object({
  action: z.literal('cancel'),
});

class MinQuotaMetError extends Error {}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug, id } = await params;

    const trip = await prisma.volunteerTrip.findUnique({
      where: { slug },
      select: { id: true, fundraiserId: true },
    });

    if (!trip) {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const batch = await prisma.volunteerBatch.findUnique({
      where: { id },
      select: {
        id: true,
        tripId: true,
        status: true,
        maxQuota: true,
        minQuota: true,
        startDate: true,
        endDate: true,
        registrationDeadline: true,
      },
    });

    if (!batch || batch.tripId !== trip.id) {
      return NextResponse.json({ error: 'Volunteer batch tidak ditemukan' }, { status: 404 });
    }

    const userRole = (session.user.role as Role) ?? 'DONOR';
    const isAdmin = userRole === 'ADMIN';
    const isOwner = isAtLeast(userRole, 'CAMPAIGN_CREATOR') && trip.fundraiserId === session.user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (batch.status !== 'OPEN') {
      return NextResponse.json(
        { error: 'Batch tidak bisa diedit pada status ini' },
        { status: 400 },
      );
    }

    const body = await request.json();

    const cancelParsed = cancelActionSchema.safeParse(body);
    if (cancelParsed.success) {
      const requestedById = session.user.id as string;

      try {
        // Locking the Batch row (via the CONFIRMED count read, serialized
        // through the transaction) before both checking minQuota and
        // creating every Refund means a Registration confirming
        // concurrently -- right as the Fundraiser cancels -- can't push
        // the count past minQuota while this cancel is mid-flight, and two
        // concurrent cancel attempts on the same Batch can't both pass the
        // guard and both bulk-refund.
        const result = await prisma.$transaction(async (tx) => {
          const confirmedCount = await tx.registration.count({
            where: { batchId: batch.id, status: 'CONFIRMED' },
          });
          if (confirmedCount >= batch.minQuota) {
            throw new MinQuotaMetError();
          }

          const cancelledBatch = await tx.volunteerBatch.update({
            where: { id: batch.id },
            data: { status: 'CANCELLED' },
          });

          const confirmedRegistrations = await tx.registration.findMany({
            where: { batchId: batch.id, status: 'CONFIRMED' },
            select: { id: true, payment: { select: { id: true, amount: true } } },
          });

          await tx.registration.updateMany({
            where: { batchId: batch.id, status: 'CONFIRMED' },
            data: { status: 'CANCELLED' },
          });

          const refunds: Array<{ registrationId: string; refundId: string; amount: number }> = [];
          for (const registration of confirmedRegistrations) {
            // A CONFIRMED Registration always has a settled Payment (see
            // prisma/schema.prisma's own comment on Registration.status).
            const payment = registration.payment!;
            const refund = await createRefund(tx, {
              subject: { type: 'trip', tripId: batch.tripId },
              paymentId: payment.id,
              amount: payment.amount,
              reason: 'Batch dibatalkan karena tidak mencapai kuota minimum',
              requestedById,
            });
            refunds.push({ registrationId: registration.id, refundId: refund.id, amount: refund.amount });
          }

          return { batch: cancelledBatch, refunds };
        });

        return NextResponse.json({
          batch: { id: result.batch.id, status: result.batch.status },
          refundedRegistrations: result.refunds,
        });
      } catch (error) {
        if (error instanceof MinQuotaMetError) {
          return NextResponse.json(
            { error: 'Batch sudah mencapai kuota minimum, tidak bisa dibatalkan' },
            { status: 400 },
          );
        }
        throw error;
      }
    }

    const result = editBatchSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const nextMaxQuota = result.data.maxQuota ?? batch.maxQuota;
    const nextMinQuota = result.data.minQuota ?? batch.minQuota;
    if (nextMinQuota > nextMaxQuota) {
      return NextResponse.json(
        { error: 'minQuota tidak boleh melebihi maxQuota', fieldErrors: { minQuota: ['minQuota tidak boleh melebihi maxQuota'] } },
        { status: 400 },
      );
    }

    const nextStartDate = result.data.startDate ? new Date(result.data.startDate) : batch.startDate;
    const nextEndDate = result.data.endDate ? new Date(result.data.endDate) : batch.endDate;
    const nextRegistrationDeadline = result.data.registrationDeadline
      ? new Date(result.data.registrationDeadline)
      : batch.registrationDeadline;

    if (nextEndDate < nextStartDate) {
      return NextResponse.json(
        { error: 'endDate tidak boleh sebelum startDate', fieldErrors: { endDate: ['endDate tidak boleh sebelum startDate'] } },
        { status: 400 },
      );
    }

    if (nextRegistrationDeadline > nextStartDate) {
      return NextResponse.json(
        {
          error: 'registrationDeadline tidak boleh setelah startDate',
          fieldErrors: { registrationDeadline: ['registrationDeadline tidak boleh setelah startDate'] },
        },
        { status: 400 },
      );
    }

    const data: Record<string, unknown> = { ...result.data };
    if (data.startDate) data.startDate = new Date(data.startDate as string);
    if (data.endDate) data.endDate = new Date(data.endDate as string);
    if (data.registrationDeadline) data.registrationDeadline = new Date(data.registrationDeadline as string);

    const updated = await prisma.volunteerBatch.update({
      where: { id: batch.id },
      data,
    });

    return NextResponse.json({ batch: updated });
  } catch (error) {
    console.error('Error updating volunteer batch:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run "src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts"`
Expected: PASS, all 16 tests (11 pre-existing + 5 new).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS, every file including `src/lib/money/refunds.test.ts` (untouched) and `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.test.ts` (untouched).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/volunteer-trips/[slug]/batches/[id]/route.ts src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts
git commit -m "feat: a Fundraiser cancels an under-quota Batch, refunding every CONFIRMED Registration in full"
```

---
