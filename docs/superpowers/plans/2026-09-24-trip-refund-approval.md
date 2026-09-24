# Trip Refund Approval Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve`, so every Trip-linked `REQUESTED` Refund that reconcile's `pendingRefunds` surfaces has a route an Admin can actually use to approve it.

**Architecture:** A structural mirror of the existing `PATCH /api/campaigns/[slug]/refunds/[id]/approve` route — same `withAssignmentCheck(Assignment.ADMIN, ...)` gate, same call to the already-subject-agnostic `approveRefund` (`src/lib/money/refunds.ts`, unmodified), differing only in its own scoping lookup (`VolunteerTrip` by slug, checking the Refund's Payment is Trip-linked to it, instead of Campaign).

**Tech Stack:** Next.js, Prisma, Postgres, Vitest.

**Spec:** .scratch/trip-refund-approval/spec.md

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0.

    <akar specflow>/scripts/check-plan-headings.sh    <rencana ini> <task-brief>
    <akar specflow>/scripts/check-seam-constraints.sh <rencana ini> <task-brief>

## Global Constraints

- No create route (`POST /api/volunteer-trips/[slug]/refunds`) — every Trip Fee refund trigger already has its own dedicated `createRefund` call site (self-cancel, batch-cancel, the settlement-race auto-refund). Do not add one.
- Do not modify `src/lib/money/refunds.ts` (`createRefund`/`approveRefund`) at all — both are already subject-agnostic and need no Trip-specific logic.
- Success response shape, error mapping, and HTTP status codes must be identical to the Campaign route's: `RefundNotFoundError` → 404 (`'Refund tidak ditemukan'`), `SelfApprovalError` → 403 (`'Refund tidak dapat disetujui oleh orang yang mengajukannya'`), `InvalidRefundStatusError` → 409 (`'Refund tidak lagi menunggu persetujuan'`), anything else → `console.error` + 500 (`'Gagal menyetujui refund'`).
- No UI, no `GET` listing route scoped to one Trip — API only, matching the Campaign route's own scope.

---

### Task 1: `PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve`

**Files:**
- Create: `src/app/api/volunteer-trips/[slug]/refunds/[id]/approve/route.ts`
- Create: `src/app/api/volunteer-trips/[slug]/refunds/[id]/approve/route.test.ts`

**Interfaces:**
- Consumes: `approveRefund(prisma: PrismaClient, params: { refundId: string; approvedById: string }): Promise<Refund>`, `RefundNotFoundError`, `SelfApprovalError`, `InvalidRefundStatusError` — all already exported from `src/lib/money/refunds.ts`, unmodified. `withAssignmentCheck` from `@/lib/withAssignmentCheck`, `Assignment` from `@/generated/prisma/client`, `getServerSession` from `@/lib/auth` — all already used identically by the Campaign sibling route.
- Produces: nothing consumed elsewhere in this plan (only task).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve` (the exported route handler), diimpor dan dipanggil langsung dengan `@/lib/prisma` di-mock (`approveRefund` sendiri TIDAK di-mock di sini -- ia dipanggil nyata lewat `prisma.$transaction` yang di-mock, persis pola file test Campaign yang menjadi acuan, karena kebenaran `approveRefund` sendiri sudah dibuktikan `src/lib/money/refunds.test.ts`). Cakup SETIAP kasus yang sudah dicakup file test Campaign yang menjadi cerminannya: 401 unauthenticated, 403 non-Admin-assignment, 404 Trip tidak ditemukan, 404 Refund milik Trip lain (atau Campaign sama sekali) daripada slug di URL, 404 refund id tidak ada sama sekali, 200 berhasil approve, 403 approver sama dengan requester, 409 refund sudah bukan REQUESTED.

- [ ] **Step 1: Read the real Campaign sibling route and its test file in full**

Read `src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts` and `src/app/api/campaigns/[slug]/refunds/[id]/approve/route.test.ts` completely before writing anything — this task is a structural mirror of both, not a fresh design. The exact code below is adapted from them; verify it still matches the real files (they should be unchanged since this plan was written).

- [ ] **Step 2: Write the failing tests**

Create `src/app/api/volunteer-trips/[slug]/refunds/[id]/approve/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    refund: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
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
        findMany: vi.fn().mockResolvedValue([]),
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
      donation: null,
      registration: { batch: { tripId: 'trip-1' } },
    },
    ...overrides,
  };
}

function patchRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/bersih-pantai/refunds/refund-1/approve', { method: 'PATCH' });
}

function routeContext(id = 'refund-1') {
  return { params: Promise.resolve({ slug: 'bersih-pantai', id }) };
}

describe('PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-2', role: 'ADMIN', assignments: ['ADMIN'] } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1' });
    mockRefundFindUnique.mockResolvedValue({ payment: { registration: { batch: { tripId: 'trip-1' } } } });
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

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it("returns 404 when the Refund's Payment belongs to a different Trip than the URL slug", async () => {
    mockRefundFindUnique.mockResolvedValue({ payment: { registration: { batch: { tripId: 'a-different-trip' } } } });
    const response = await PATCH(patchRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the Refund's Payment is Campaign-linked, not Trip-linked at all", async () => {
    mockRefundFindUnique.mockResolvedValue({ payment: { registration: null } });
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

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/\[slug\]/refunds/\[id\]/approve/route.test.ts`
Expected: FAIL — the route file doesn't exist yet, so the import itself fails.

- [ ] **Step 4: Implement the route**

Create `src/app/api/volunteer-trips/[slug]/refunds/[id]/approve/route.ts`:

```typescript
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
 * PATCH /api/volunteer-trips/[slug]/refunds/[id]/approve -- a different Admin
 * approves a REQUESTED Refund and posts its settlement in the same action.
 *
 * Structural mirror of the Campaign sibling route
 * (src/app/api/campaigns/[slug]/refunds/[id]/approve/route.ts): approveRefund
 * itself is already subject-agnostic and needs no Trip-specific logic at
 * all -- the only thing genuinely different here is this route's own
 * Trip-vs-Campaign scoping lookup.
 */
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (_request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

  const trip = await prisma.volunteerTrip.findUnique({ where: { slug }, select: { id: true } });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }

  const refund = await prisma.refund.findUnique({
    where: { id },
    select: { payment: { select: { registration: { select: { batch: { select: { tripId: true } } } } } } },
  });
  if (!refund || refund.payment.registration?.batch.tripId !== trip.id) {
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/\[slug\]/refunds/\[id\]/approve/route.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 6: Run the full suite once, and confirm no new `tsc --noEmit` errors**

Run: `npx vitest run`
Expected: PASS, 0 failures.

Run: `npx tsc --noEmit`. This plan adds one new, fully-typed file pair with no pre-existing type gaps to close — report the total error count before and after; it should be unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/volunteer-trips/\[slug\]/refunds/\[id\]/approve/route.ts src/app/api/volunteer-trips/\[slug\]/refunds/\[id\]/approve/route.test.ts
git commit -m "feat: Admin approves a Trip-linked Refund

Structural mirror of the Campaign approve route -- approveRefund is already
subject-agnostic, so this route differs only in its own Trip-vs-Campaign
scoping lookup. Closes the gap reconcile's pendingRefunds surfaced: every
Trip-linked REQUESTED Refund (from self-cancel, Batch-cancel, or the
settlement-race auto-refund) was discoverable but had no route to approve it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```
