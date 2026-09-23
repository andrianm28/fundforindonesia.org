# Volunteer Registration and Trip Fee Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Volunteer can register on an open Volunteer Batch and pay its Trip Fee — registering alone does not claim the seat; the seat is held provisionally and only becomes confirmed, and only then counts against quota, once the Trip Fee payment settles. This is the first point where real money moves for a Volunteer Trip.

**Architecture:** A new `Registration` model (HOLD/CONFIRMED/EXPIRED/CANCELLED) is the Trip-side analog of `Donation`, and its `Payment` (via the `registrationId` column Ticket 01 already added as a plain scalar) is the Trip-side analog of a Donation's Payment. This plan is where that plain scalar finally gets its real `@relation`, now that `Registration` exists to point it at. Every shared money-movement function generalized in Ticket 01 (`paymentSettledLegs`, `escrowReleaseLegs`, `releaseMaturedEscrow`) and every route that couldn't be touched then because `Registration`/`VolunteerBatch` didn't exist yet (`releaseMaturedEscrow`'s candidate query, the settlement webhook's `paid`/`failed` branches, `GET /api/admin/reconcile`'s `strandedEscrow`/`deferredEscrowWatchdog`) get their Trip branch here, by branching on whether a `Payment`'s `donationId` or `registrationId` is set. Zero behavior change on the Campaign path in every one of those functions — the same discipline Ticket 01 already established and this plan inherits.

**Tech Stack:** Next.js, Prisma, Postgres, Vitest, Zod.

**Spec:** .scratch/volunteer-trip/spec.md (ticket: .scratch/volunteer-trip/issues/03-registration-and-trip-fee-payment.md)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    <akar specflow>/scripts/check-plan-headings.sh    <rencana ini> <task-brief>
    <akar specflow>/scripts/check-seam-constraints.sh <rencana ini> <task-brief>

## Global Constraints

- New `RegistrationStatus` enum: `HOLD`, `CONFIRMED`, `EXPIRED`, `CANCELLED`. `HOLD` and `CONFIRMED` together count toward a Batch's `maxQuota`; only `CONFIRMED` counts toward its `minQuota`.
- New `Registration` model: belongs to one `User` (the Volunteer) and one `VolunteerBatch`, a `holdExpiresAt`, a `status`, and a `payment Payment?` back-relation. `Payment.registrationId` (a plain scalar since Ticket 01) gets its real `@relation` here, mirroring `Donation.payment`/`Payment.donationId`'s shape exactly — including the same `onDelete: Restrict` pinning Ticket 01's final review already established is required for every Payment-side relation to an optional FK (a fresh optional relation defaults to Prisma's implicit `SetNull` unless pinned otherwise, the exact class of bug that review caught for `Payment.donation`/`Payout.campaign`; this plan applies that lesson proactively rather than waiting for a review to catch it again).
- `Registration.status` is denormalized, kept in sync with its `Payment.status` — same dual-write shape and standing guard-test discipline this codebase already uses for `Campaign.status`/`Campaign.lifecycleStatus`.
- `POST /api/volunteer-trips/[slug]/batches/[id]/registrations`: sweeps expired holds on this Batch first, refuses if `HOLD + CONFIRMED` count is at `maxQuota`, creates a `HOLD` Registration and `PENDING` Payment via the same provider integration `POST /api/donations` uses, returns the same provider-checkout response shape. Any authenticated user may register — no role gate, unlike Campaign creation.
- The hold-expiry sweep is its own tested function, modeled on `releaseMaturedEscrow`'s shape, distinct from the escrow-maturity sweep.
- `releaseMaturedEscrow` generalizes to cover Registration-linked Payments: same subject-resolution branching Ticket 01 already established elsewhere, applied to this function's candidate query and its per-payment lock target (locks `VolunteerTrip` for a Trip-subject payment, `Campaign` for a Campaign-subject one).
- The settlement webhook's `paid` branch, for a Registration-linked Payment: no Campaign-equivalent `collectedAmount`/target-met update (`VolunteerTrip` has no such field); flips `Registration.status` to `CONFIRMED`; posts `paymentSettledLegs` with a Trip subject; sends a new `notifyRegistrationConfirmed`. The `failed`/`expired` branch flips `Registration.status` to `EXPIRED`.
- `GET /api/admin/reconcile` gains `strandedEscrow`/`deferredEscrowWatchdog`'s Trip variants, resolving the subject via `payment.registration.batch.tripId` instead of `payment.donation.campaignId`.
- No Platform Fee leg is ever posted against a Trip Fee settlement — explicit regression test, not just an absence.
- `GET /api/volunteer-trips/[slug]`'s `remainingQuota` (Ticket 02 hardcoded it to `maxQuota`) now reflects real `HOLD + CONFIRMED` counts.
- Out of scope: `Payout.volunteerTripId`'s `@relation` (left as a plain scalar by Ticket 02 despite `VolunteerTrip` now existing — a real, tracked gap, but it belongs to whichever ticket first builds a real Trip payout flow and actually needs to `.include()` through it, not this one). Out of scope: the Trip Fee refund rule, Batch cancellation, the participation dashboard, any UI.

---

### Task 1: Schema — `Registration`, and wiring `Payment.registrationId`'s real relation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_registration/migration.sql`

**Interfaces:**
- Consumes: `VolunteerBatch` (Ticket 02), `Payment.registrationId` plain scalar (Ticket 01).
- Produces: `Registration` model (fields: `id`, `volunteerId`, `batchId`, `status: RegistrationStatus`, `holdExpiresAt`, `createdAt`, `updatedAt`, relations `volunteer: User`, `batch: VolunteerBatch`, `payment: Payment?`) and `RegistrationStatus` enum, which Tasks 2, 3, and 4 all consume. `Payment.registration: Registration?` relation, which Tasks 2 and 3 consume when creating/reading a Registration's Payment.

**Seam constraint (MENGIKAT task ini, dari spec):** Task ini tidak punya seam kode (murni skema + migrasi). Cakup SETIAP kolom dan enum yang didaftarkan di Global Constraints persis sesuai nama dan tipe di sana; tidak ada test untuk task ini selain memastikan `npx prisma generate` berhasil dan seluruh test suite yang sudah ada tetap hijau setelah migrasi.

- [ ] **Step 1: Add the enum and model to `prisma/schema.prisma`**

Add after the existing `VolunteerBatch` model (in the `// ==================== Volunteer Trip ====================` section):

```prisma
enum RegistrationStatus {
  HOLD
  CONFIRMED
  EXPIRED
  CANCELLED
}

/// A Volunteer's registration on one Volunteer Batch. HOLD and CONFIRMED
/// together count toward the Batch's maxQuota; only CONFIRMED counts toward
/// minQuota. status is denormalized from this Registration's Payment.status
/// -- the same dual-write shape Campaign.status/lifecycleStatus already
/// uses, kept in sync by the settlement webhook (Task 3) and the
/// hold-expiry sweep (Task 2), never by this Registration being written
/// directly outside those two paths.
model Registration {
  id            String             @id @default(cuid())
  volunteerId   String
  batchId       String
  status        RegistrationStatus @default(HOLD)
  holdExpiresAt DateTime
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  // Relations
  volunteer User           @relation(fields: [volunteerId], references: [id], onDelete: Cascade)
  batch     VolunteerBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  payment   Payment?

  @@index([volunteerId])
  @@index([batchId])
  @@index([status])
  @@index([holdExpiresAt])
}
```

(`onDelete: Cascade` on both relations matches `Donation.campaign`'s and `Donation.donor`-adjacent convention — Registration is an "intent" record that makes sense to cascade-delete with its parent, the same class as Donation, not the same class as Payment below.)

Add `registrations Registration[]` to `VolunteerBatch`'s Relations block, alongside its existing fields:

```prisma
  // Relations
  trip          VolunteerTrip        @relation(fields: [tripId], references: [id], onDelete: Cascade)
  registrations Registration[]
```

Add `registrations Registration[]` to `User`'s Relations block, alongside the existing `volunteerTrips VolunteerTrip[]` line.

Find the `Payment` model's `registrationId` field and its stale doc comment, and replace both the comment and add the relation:

```prisma
  /// Set instead of donationId for a Trip Fee payment -- exactly one of the
  /// two is ever set, enforced by assertExactlyOnePaymentSubject
  /// (./src/lib/money/payment-subject.ts), not by a schema constraint
  /// Prisma cannot express. onDelete: Restrict, matching donationId's own
  /// pinning -- a fresh optional relation defaults to Prisma's implicit
  /// SetNull otherwise, the exact class of bug a whole-branch review on an
  /// earlier ticket caught for donationId/campaignId. Applied here
  /// proactively.
  registrationId String?       @unique
  registration   Registration? @relation(fields: [registrationId], references: [id], onDelete: Restrict)
```

- [ ] **Step 2: Generate the Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client ... to ./src/generated/prisma`.

- [ ] **Step 3: Write the migration SQL**

Check first whether `DATABASE_URL` is reachable; try `npx prisma migrate dev --name add_registration`. If it succeeds, skip to Step 4. If not, hand-write `prisma/migrations/<YYYYMMDDHHMMSS>_add_registration/migration.sql` (timestamp later than `20260923100000`, the most recent existing migration — check `ls prisma/migrations/`), matching this repo's existing style:

```sql
-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('HOLD', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'HOLD',
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Registration_volunteerId_idx" ON "Registration"("volunteerId");

-- CreateIndex
CREATE INDEX "Registration_batchId_idx" ON "Registration"("batchId");

-- CreateIndex
CREATE INDEX "Registration_status_idx" ON "Registration"("status");

-- CreateIndex
CREATE INDEX "Registration_holdExpiresAt_idx" ON "Registration"("holdExpiresAt");

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "VolunteerBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Run the full existing test suite to confirm no regression from the schema addition alone**

Run: `npx vitest run`
Expected: PASS, same 125 files / 1268 tests as this plan's baseline.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Registration schema, wire Payment.registrationId's real relation

Registration is the Trip-side analog of Donation: belongs to a Volunteer
and a VolunteerBatch, HOLD/CONFIRMED/EXPIRED/CANCELLED, denormalized status
kept in sync with its Payment. Payment.registrationId -- a plain scalar
since the money-layer generalization ticket -- gets its real @relation now
that Registration exists, pinned onDelete: Restrict to match donationId's
own pinning (a fresh optional relation defaults to Prisma's implicit
SetNull otherwise, the exact class of bug that ticket's final review
caught -- applied here proactively rather than waiting for a review to
catch it again).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```

---

### Task 2: Volunteer registers and gets a Trip Fee charge

**Files:**
- Create: `src/lib/volunteer/registration.ts`
- Create: `src/lib/volunteer/registration.test.ts`
- Create: `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts`
- Create: `src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.test.ts`
- Modify: `src/app/api/volunteer-trips/[slug]/route.ts` (the existing `GET`, from Ticket 02/03)
- Modify: `src/app/api/volunteer-trips/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `Registration`/`RegistrationStatus` (Task 1), `VolunteerBatch` (Ticket 02), `getPaymentProvider`/`PaymentMethod` (`@/lib/payments`), `getServerSession` (`@/lib/auth`).
- Produces: `releaseExpiredHolds(batchId: string): Promise<{ expiredCount: number; consideredCount: number }>` exported from `src/lib/volunteer/registration.ts`, consumed by the registration route in this task and reusable by any future route that needs the same sweep. The route itself: `POST /api/volunteer-trips/[slug]/batches/[id]/registrations`.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah (a) pemanggilan langsung terhadap `releaseExpiredHolds`, dan (b) route handler yang diekspor (`POST`), diimpor dan dipanggil langsung dengan `@/lib/prisma`, `@/lib/auth`, dan `@/lib/payments` di-mock. Cakup SETIAP perilaku MELALUI seam itu: sweep hold kedaluwarsa, kuota penuh, registrasi ganda oleh volunteer yang sama, race dua permintaan bersamaan pada kursi terakhir, dan setiap jalur kegagalan (401, 404 batch, 400 batch tidak OPEN, 503 provider). Nilai harapan dalam test harus literal yang diketahui.

- [ ] **Step 1: Write the failing tests for `releaseExpiredHolds`**

```typescript
// src/lib/volunteer/registration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { releaseExpiredHolds } from './registration';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registration: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

const mockFindMany = prisma.registration.findMany as unknown as import('vitest').Mock;
const mockUpdateMany = prisma.registration.updateMany as unknown as import('vitest').Mock;

describe('releaseExpiredHolds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flips expired HOLD registrations to EXPIRED, scoped to the given batch', async () => {
    mockFindMany.mockResolvedValue([{ id: 'reg-1' }, { id: 'reg-2' }]);
    mockUpdateMany.mockResolvedValue({ count: 2 });

    const result = await releaseExpiredHolds('batch-1');

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ batchId: 'batch-1', status: 'HOLD', holdExpiresAt: { lte: expect.any(Date) } }),
      }),
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['reg-1', 'reg-2'] }, status: 'HOLD' }),
        data: { status: 'EXPIRED' },
      }),
    );
    expect(result).toEqual({ expiredCount: 2, consideredCount: 2 });
  });

  it('returns zero counts when nothing is expired', async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await releaseExpiredHolds('batch-1');

    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ expiredCount: 0, consideredCount: 0 });
  });

  it('sweeps across all batches when no batchId is given', async () => {
    mockFindMany.mockResolvedValue([]);
    await releaseExpiredHolds();
    const call = mockFindMany.mock.calls[0][0];
    expect(call.where.batchId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/volunteer/registration.test.ts`
Expected: FAIL — `Cannot find module './registration'`.

- [ ] **Step 3: Implement `releaseExpiredHolds`**

```typescript
// src/lib/volunteer/registration.ts
import { prisma } from '@/lib/prisma';

/**
 * Finds every Registration still HOLD whose holdExpiresAt has passed and
 * flips it to EXPIRED, freeing the seat for the next registration attempt
 * (HOLD no longer counts toward maxQuota once it's EXPIRED).
 *
 * Modeled directly on releaseMaturedEscrow's shape (src/lib/money/
 * escrow.ts): no scheduler exists in this repo, so this runs at the top of
 * the registration route, for the requesting Batch, the same way escrow
 * release runs at the top of a payout request. Pass a batchId to scope the
 * sweep to one Batch (how the registration route calls it); omit it to
 * sweep across all Batches.
 *
 * A plain updateMany, not a per-row transaction like releaseMaturedEscrow:
 * this sweep moves no money and posts no ledger entries, so there is no
 * per-row financial invariant to protect with a lock -- flipping a status
 * column is safe to batch in one statement.
 */
export async function releaseExpiredHolds(
  batchId?: string,
): Promise<{ expiredCount: number; consideredCount: number }> {
  const now = new Date();

  const expired = await prisma.registration.findMany({
    where: {
      status: 'HOLD',
      holdExpiresAt: { lte: now },
      ...(batchId ? { batchId } : {}),
    },
    select: { id: true },
  });

  if (expired.length === 0) {
    return { expiredCount: 0, consideredCount: 0 };
  }

  const ids = expired.map((r) => r.id);
  const updated = await prisma.registration.updateMany({
    where: { id: { in: ids }, status: 'HOLD' },
    data: { status: 'EXPIRED' },
  });

  return { expiredCount: updated.count, consideredCount: expired.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/volunteer/registration.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Write the failing tests for `POST .../registrations`**

Read `src/app/api/donations/route.ts` and its test file first for the exact provider-mock shape this route's tests need to mirror (the `getPaymentProvider`/`provider.createCharge` mock pattern) before writing these — the sketch below shows the assertions, adapt the provider mock scaffolding to match that file's real, existing pattern.

```typescript
// src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerBatch: { findUnique: vi.fn() },
    registration: { findMany: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    payment: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments', () => ({
  getPaymentProvider: vi.fn(),
  PaymentProviderNotConfiguredError: class extends Error {},
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';
import { POST } from './route';

const mockBatchFindUnique = prisma.volunteerBatch.findUnique as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

function createRequest(body: unknown = { paymentMethod: 'qris' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug/batches/batch-1/registrations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug', id = 'batch-1') {
  return { params: Promise.resolve({ slug, id }) };
}

describe('POST /api/volunteer-trips/[slug]/batches/[id]/registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'volunteer-1' } });
    mockBatchFindUnique.mockResolvedValue({
      id: 'batch-1',
      status: 'OPEN',
      maxQuota: 20,
      trip: { id: 'trip-1', tripFeeAmount: 1_500_000 },
    });
    mockGetPaymentProvider.mockReturnValue({
      name: 'sumopod',
      method: 'qris_redirect',
      createCharge: vi.fn().mockResolvedValue({ method: 'qris_redirect', redirectUrl: 'https://pay.example/x', expiresAt: new Date('2026-12-01') }),
    });
    // Simulate the transaction callback running against a tx that behaves
    // like prisma itself for the registration count/create calls -- adapt
    // this fixture to whatever shape this file's sibling route tests
    // (volunteer-trips/route.test.ts) already establish for $transaction.
    mockTransaction.mockImplementation(async (cb) => cb(prisma));
    (prisma.registration.count as unknown as Mock).mockResolvedValue(0);
    (prisma.registration.findFirst as unknown as Mock).mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
  });

  it('returns 404 for a nonexistent batch', async () => {
    mockBatchFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns 400 when the batch is not OPEN', async () => {
    mockBatchFindUnique.mockResolvedValue({ id: 'batch-1', status: 'CLOSED', maxQuota: 20, trip: { id: 'trip-1', tripFeeAmount: 1_500_000 } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(400);
  });

  it('returns 400 (Batch full) when HOLD+CONFIRMED count is at maxQuota', async () => {
    (prisma.registration.count as unknown as Mock).mockResolvedValue(20);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/penuh/i);
  });

  it('returns 400 when the same Volunteer already has an open HOLD/CONFIRMED registration on this batch', async () => {
    (prisma.registration.findFirst as unknown as Mock).mockResolvedValue({ id: 'existing-reg' });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(400);
  });

  it('creates a HOLD registration and a PENDING payment for the trip fee amount', async () => {
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(201);
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ registrationId: expect.any(String), donationId: undefined, amount: 1_500_000, status: 'PENDING' }),
      }),
    );
  });

  it('returns 503 when the payment provider is not configured', async () => {
    const { PaymentProviderNotConfiguredError } = await import('@/lib/payments');
    mockGetPaymentProvider.mockImplementation(() => {
      throw new PaymentProviderNotConfiguredError();
    });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(503);
  });
});
```

(This sketch simplifies the transaction/count mocking; read `src/app/api/donations/route.test.ts` for how this repo's existing tests actually shape a Prisma-transaction-plus-provider-charge test, and match that shape exactly rather than inventing a new one.)

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `POST /api/volunteer-trips/[slug]/batches/[id]/registrations`**

```typescript
// src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';
import type { PaymentMethod } from '@/lib/payments';
import { PaymentStatus } from '@/generated/prisma/client';
import { releaseExpiredHolds } from '@/lib/volunteer/registration';

const HOLD_WINDOW_MS = 30 * 60 * 1000; // 30 minutes -- see plan Further Notes: this exact duration is an open parameter, not re-derived from any spec value.

const VALID_PAYMENT_METHODS = ['bank_transfer', 'qris'] as const;
const PROVIDER_METHOD_FOR: Record<(typeof VALID_PAYMENT_METHODS)[number], PaymentMethod> = {
  bank_transfer: 'bank_transfer_va',
  qris: 'qris_redirect',
};

const registerSchema = z.object({
  paymentMethod: z.enum(VALID_PAYMENT_METHODS, { error: 'Metode pembayaran tidak valid.' }),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: batchId } = await params;

    const batch = await prisma.volunteerBatch.findUnique({
      where: { id: batchId },
      select: { id: true, status: true, maxQuota: true, trip: { select: { id: true, tripFeeAmount: true } } },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Volunteer batch tidak ditemukan' }, { status: 404 });
    }

    if (batch.status !== 'OPEN') {
      return NextResponse.json({ error: 'Batch ini tidak menerima registrasi' }, { status: 400 });
    }

    const body = await request.json();
    const result = registerSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    let provider;
    try {
      provider = getPaymentProvider();
    } catch (err) {
      if (err instanceof PaymentProviderNotConfiguredError) {
        return NextResponse.json(
          { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
          { status: 503 },
        );
      }
      throw err;
    }

    const wantedMethod = PROVIDER_METHOD_FOR[result.data.paymentMethod];
    if (wantedMethod !== provider.method) {
      return NextResponse.json(
        { error: 'Metode pembayaran ini belum tersedia. Silakan pilih metode lain.' },
        { status: 503 },
      );
    }

    // 1. Sweep expired holds on THIS batch first, at the top of the request
    // -- no scheduler needed, mirrors releaseMaturedEscrow's own pattern.
    await releaseExpiredHolds(batchId);

    // 2. Lock the Batch row before reading the quota count, so two
    // concurrent registration attempts at the last seat serialize on this
    // lock rather than both reading the same pre-insert count -- the same
    // "lock the contended resource before reading an aggregate derived from
    // it" pattern already used for Campaign balance checks in
    // lib/money/payouts.ts and lib/money/escrow.ts.
    const registration = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "VolunteerBatch" WHERE id = ${batchId} FOR UPDATE`;

      const occupied = await tx.registration.count({
        where: { batchId, status: { in: ['HOLD', 'CONFIRMED'] } },
      });
      if (occupied >= batch.maxQuota) {
        throw new BatchFullError();
      }

      const existing = await tx.registration.findFirst({
        where: { volunteerId: session!.user.id, batchId, status: { in: ['HOLD', 'CONFIRMED'] } },
        select: { id: true },
      });
      if (existing) {
        throw new DuplicateRegistrationError();
      }

      return tx.registration.create({
        data: {
          volunteerId: session!.user.id,
          batchId,
          status: 'HOLD',
          holdExpiresAt: new Date(Date.now() + HOLD_WINDOW_MS),
        },
      });
    }).catch((err) => {
      if (err instanceof BatchFullError || err instanceof DuplicateRegistrationError) return err;
      throw err;
    });

    if (registration instanceof BatchFullError) {
      return NextResponse.json({ error: 'Batch ini sudah penuh' }, { status: 400 });
    }
    if (registration instanceof DuplicateRegistrationError) {
      return NextResponse.json(
        { error: 'Anda sudah memiliki registrasi aktif pada batch ini' },
        { status: 400 },
      );
    }

    // 3. Charge, outside the transaction that created the Registration --
    // the Registration is already committed, so a failed charge leaves a
    // recoverable HOLD (it simply expires via the sweep) rather than an
    // uncommitted row holding a database connection across a provider round
    // trip. Mirrors POST /api/donations's own reasoning exactly.
    let charge;
    try {
      charge = await provider.createCharge({
        orderId: registration.id,
        grossAmount: batch.trip.tripFeeAmount,
        currency: 'IDR',
      });
    } catch (err) {
      console.error(`[registrations] charge failed for registration ${registration.id}:`, err);
      return NextResponse.json(
        { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
        { status: 503 },
      );
    }

    await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: provider.name,
        method: charge.method,
        providerRef: registration.id,
        amount: batch.trip.tripFeeAmount,
        status: PaymentStatus.PENDING,
        expiresAt: charge.expiresAt,
      },
    });

    const paymentInstructions =
      charge.method === 'qris_redirect'
        ? { type: 'qris' as const, redirectUrl: charge.redirectUrl, expiresAt: charge.expiresAt }
        : { type: 'bank_transfer' as const, vaNumber: charge.vaNumber, expiresAt: charge.expiresAt };

    return NextResponse.json(
      { registrationId: registration.id, amount: batch.trip.tripFeeAmount, paymentInstructions },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating registration:', error);
    return NextResponse.json({ error: 'Gagal membuat registrasi' }, { status: 500 });
  }
}

class BatchFullError extends Error {}
class DuplicateRegistrationError extends Error {}
```

Note the `mockTransaction.mockImplementation(async (cb) => cb(prisma))` shape in the test sketch means `tx` and `prisma` are the same mock object in tests — verify this is genuinely how the sibling `campaigns/[slug]/payouts/route.test.ts` or similar existing transaction-based route test already does it, and match that file's real pattern; do not invent a divergent one.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 9: Add the concurrency regression test**

Add to the same test file:

```typescript
it('CONCURRENCY: two simultaneous registrations at the last remaining seat -- exactly one succeeds', async () => {
  // Simulate the row lock's serializing effect: the first call to
  // registration.count sees 19 (one seat left, maxQuota 20), the second
  // (running "after" the first's transaction commits, as the real FOR
  // UPDATE lock would force) sees 20 (full). This test proves the ROUTE's
  // logic correctly refuses the second given that count, not that the
  // mocked $transaction itself serializes concurrent JS calls (it can't --
  // real serialization is a Postgres row-lock property this seam cannot
  // exercise; what this test proves is that the code correctly acts on
  // whatever count the lock would have made accurate).
  const countMock = prisma.registration.count as unknown as Mock;
  countMock.mockResolvedValueOnce(19).mockResolvedValueOnce(20);

  const [first, second] = await Promise.all([
    POST(createRequest(), routeContext()),
    POST(createRequest(), routeContext()),
  ]);

  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([201, 400]);
});
```

- [ ] **Step 10: Run the tests to verify it passes**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/batches/[id]/registrations/route.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 11: Update `GET /api/volunteer-trips/[slug]`'s `remainingQuota` to reflect real counts**

Read the current `src/app/api/volunteer-trips/[slug]/route.ts` (its `GET` export, added in Ticket 02/03) — it currently computes `remainingQuota: batch.maxQuota` unconditionally (a placeholder comment says a later ticket will subtract real counts; this is that ticket). Change the batch-mapping step to compute a real count:

```typescript
const batches = await prisma.volunteerBatch.findMany({
  where: { tripId: trip.id, status: 'OPEN' },
  orderBy: { startDate: 'asc' },
});

const batchesWithRemaining = await Promise.all(
  batches.map(async (batch) => {
    const occupied = await prisma.registration.count({
      where: { batchId: batch.id, status: { in: ['HOLD', 'CONFIRMED'] } },
    });
    return { ...batch, remainingQuota: Math.max(0, batch.maxQuota - occupied) };
  }),
);
```

Add a test to `src/app/api/volunteer-trips/[slug]/route.test.ts` (extend the existing `vi.mock('@/lib/prisma', ...)` block with `registration: { count: vi.fn() }`):

```typescript
it('remainingQuota reflects real HOLD+CONFIRMED counts, not just maxQuota', async () => {
  mockBatchFindMany.mockResolvedValue([{ id: 'batch-1', tripId: 'trip-1', status: 'OPEN', maxQuota: 20 }]);
  (prisma.registration.count as unknown as Mock).mockResolvedValue(5);

  const response = await GET(getRequest(), routeContext());
  const data = await response.json();

  expect(data.trip.batches[0].remainingQuota).toBe(15);
});
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/route.test.ts`
Expected: PASS, all tests including the new one.

- [ ] **Step 13: Run the full suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS, baseline (125 files / 1268 tests) plus this task's new tests, 0 failures.

- [ ] **Step 14: Commit**

```bash
git add src/lib/volunteer src/app/api/volunteer-trips/[slug]/batches/[id]/registrations src/app/api/volunteer-trips/[slug]/route.ts src/app/api/volunteer-trips/[slug]/route.test.ts
git commit -m "feat: Volunteer registers on a Batch and gets a Trip Fee charge

POST .../batches/[id]/registrations sweeps expired holds first (new
releaseExpiredHolds, modeled on releaseMaturedEscrow's shape), locks the
Batch row before reading the HOLD+CONFIRMED count so two concurrent
registrations at the last seat serialize correctly, refuses a duplicate
open registration by the same Volunteer, then creates a HOLD Registration
and charges the Trip Fee via the same provider integration
POST /api/donations already uses. GET .../[slug]'s remainingQuota now
subtracts real counts instead of always showing maxQuota.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```

---

### Task 3: Settlement — `releaseMaturedEscrow` and the webhook's Trip branch

**Files:**
- Modify: `src/lib/money/escrow.ts`
- Modify: `src/lib/money/escrow.test.ts`
- Modify: `src/app/api/webhooks/[provider]/route.ts`
- Modify: `src/app/api/webhooks/[provider]/route.test.ts`
- Modify: `src/lib/notifications.ts`
- Create: `src/lib/notifications.test.ts` (if it doesn't already exist — check first; if it does, extend it)

**Interfaces:**
- Consumes: `Registration`/`RegistrationStatus` (Task 1), `LedgerSubject`/`paymentSettledLegs`/`escrowReleaseLegs` (already generalized, unmodified — `lib/money/ledger.ts`).
- Produces: `notifyRegistrationConfirmed(params: { volunteerId: string; tripId: string; tripSlug: string; tripTitle: string; amount: number }): Promise<void>`, sibling of the existing `notifyDonationConfirmed`. Nothing else this task produces is consumed by Task 4 (reconcile's changes are independent of the webhook/sweep's internals, only of the schema Task 1 already provides).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah (a) pemanggilan langsung terhadap `releaseMaturedEscrow`, dan (b) route handler `POST` di `api/webhooks/[provider]/route.ts`, diimpor dan dipanggil langsung dengan `@/lib/prisma` di-mock. Cakup SETIAP kombinasi subject (Donation-linked dan Registration-linked Payment) MELALUI seam itu, termasuk jalur `paid` dan `failed`/`expired`, dan pastikan SETIAP test Campaign-path yang sudah ada di kedua file tetap lolos tanpa perubahan nilai harapan.

- [ ] **Step 1: Write the failing tests for `releaseMaturedEscrow`'s Trip branch**

Read `src/lib/money/escrow.test.ts` in full first — it has its own `makeTx`-style fixture or direct `prisma` mocking (confirm which before writing). Add, using whatever pattern that file already establishes for a Campaign-subject payment (mirror it exactly for the Trip case):

```typescript
describe('releaseMaturedEscrow -- trip-linked payments', () => {
  it('releases a matured Registration-linked payment into TRIP_BALANCE, locking VolunteerTrip not Campaign', async () => {
    // Arrange one matured PAID payment with registrationId set (donationId
    // null), whose registration.batch.tripId resolves to 'trip-1'. Assert
    // the row-lock raw query targets "VolunteerTrip" (not "Campaign"), and
    // that the posted legs came from escrowReleaseLegs({ subject: {
    // type: 'trip', tripId: 'trip-1' }, ... }) -- adapt to this file's
    // existing assertion style for the analogous Campaign-linked test.
  });

  it('does not affect a Campaign-linked payment in the same sweep call -- both subjects processed correctly in one pass', async () => {
    // One Campaign-linked and one Registration-linked matured payment in
    // the same candidate set; both get released, each against its own
    // subject's balance account.
  });

  it('every existing Campaign-linked test in this file still passes unchanged', async () => {
    // Not a new test -- this is a reminder to actually run the file's
    // existing tests after Step 3, not a test to write.
  });
});
```

(This step's tests are sketched at the level of intent, not literal code, because they depend entirely on this file's own existing fixture shape, which you must read first — do not invent a parallel fixture style.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/money/escrow.test.ts`
Expected: FAIL — the new trip-linked assertions fail because the function doesn't branch yet.

- [ ] **Step 3: Implement the Trip branch in `releaseMaturedEscrow`**

The current function (read `src/lib/money/escrow.ts` in full before editing — line numbers below are as of this plan's writing and may have shifted):

- The candidate query (`prisma.payment.findMany`) currently does `...(campaignId ? { donation: { campaignId } } : {})` in `where`, and selects `donation: { select: { campaignId: true } }`. Generalize the caller-facing parameter and the query:

```typescript
export interface ReleaseSweepSubject {
  type: 'campaign' | 'trip';
  id: string;
}

export async function releaseMaturedEscrow(subject?: ReleaseSweepSubject): Promise<ReleaseSweepResult> {
  const now = new Date();

  const matured = await prisma.payment.findMany({
    where: {
      status: 'PAID',
      escrowReleaseAt: { lte: now },
      escrowReleasedAt: null,
      ...(subject?.type === 'campaign' ? { donation: { campaignId: subject.id } } : {}),
      ...(subject?.type === 'trip' ? { registration: { batch: { tripId: subject.id } } } : {}),
    },
    select: {
      id: true,
      amount: true,
      providerFee: true,
      donationId: true,
      registrationId: true,
      donation: { select: { campaignId: true } },
      registration: { select: { batch: { select: { tripId: true } } } },
    },
    orderBy: { escrowReleaseAt: 'asc' },
    take: ESCROW_RELEASE_SWEEP_LIMIT,
  });
  // ...
```

This is a **breaking signature change** to an already-called function. Verified by grep (re-check before editing in case this has shifted): there is exactly one production call site, `src/app/api/campaigns/[slug]/payouts/route.ts:65`, currently `await releaseMaturedEscrow(campaign.id);`. Change it to `await releaseMaturedEscrow({ type: 'campaign', id: campaign.id });`. Its test file (`src/app/api/campaigns/[slug]/payouts/route.test.ts`) does not assert on the exact call signature anywhere (verified — it only exercises `releaseMaturedEscrow`'s real, unmocked behavior against a fake transaction client), so no test change is needed there; just confirm that file's own tests still pass after this edit.

- Inside the per-payment loop, replace the single `const paymentCampaignId = payment.donation.campaignId;` line and its Campaign-only lock/legs with a branch:

```typescript
  for (const payment of matured) {
    const paymentSubject: LedgerSubject = payment.donationId
      ? { type: 'campaign', campaignId: payment.donation!.campaignId }
      : { type: 'trip', tripId: payment.registration!.batch.tripId };

    try {
      const released = await prisma.$transaction(async (tx) => {
        // Lock ordering: see this function's existing comment about the
        // webhook and this sweep never contending on the same Payment row.
        // The Trip branch preserves the exact same invariant -- the
        // webhook's Trip-settlement branch (Step 5 below) must not write a
        // Payment outside PENDING either.
        if (paymentSubject.type === 'campaign') {
          await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${paymentSubject.campaignId} FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT id FROM "VolunteerTrip" WHERE id = ${paymentSubject.tripId} FOR UPDATE`;
        }

        // ... refunds / claim logic unchanged ...

        if (amountToRelease > 0) {
          await postTransaction(
            tx,
            escrowReleaseLegs({ subject: paymentSubject, amount: amountToRelease }),
            { paymentId: payment.id, transactionId: `escrow-release:${payment.id}` },
          );
        }

        return true;
      });
      if (released) releasedCount++;
    } catch (err) {
      console.error(`releaseMaturedEscrow: failed to release payment ${payment.id}`, err);
    }
  }
```

Import `LedgerSubject` from `./ledger` at the top of the file. Keep every other line of the transaction body (refund lookup, claim, amount computation) exactly as-is — none of that logic is subject-specific.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/money/escrow.test.ts`
Expected: PASS, every existing Campaign-linked test unchanged plus the new Trip-linked ones.

- [ ] **Step 5: Add `notifyRegistrationConfirmed`**

In `src/lib/notifications.ts`, add alongside `notifyDonationConfirmed`:

```typescript
/**
 * Create a notification for a confirmed Trip Fee registration. Sibling of
 * notifyDonationConfirmed -- only the Volunteer is notified (unlike a
 * Donation, there is no second party to notify on every single
 * registration; the Fundraiser is not notified per-registration in this
 * ticket's scope).
 */
export async function notifyRegistrationConfirmed(params: {
  volunteerId: string;
  tripSlug: string;
  tripTitle: string;
  amount: number;
}) {
  const { volunteerId, tripSlug, tripTitle, amount } = params;

  await prisma.notification.create({
    data: {
      type: 'registration_confirmed',
      title: 'Registrasi Berhasil',
      message: `Registrasi Anda untuk "${tripTitle}" sebesar ${formatRupiah(amount)} telah berhasil dikonfirmasi`,
      userId: volunteerId,
      link: `/volunteer-trip/${tripSlug}`,
    },
  });
}
```

If `src/lib/notifications.test.ts` doesn't exist yet, create it with a test for this function alone (mock `@/lib/prisma`, assert `notification.create` is called with the right `userId`/`type`/`link`); if it exists, add the test alongside the others.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/notifications.test.ts` (or wherever the test landed)
Expected: PASS.

- [ ] **Step 7: Write the failing tests for the webhook's Trip branch**

Read `src/app/api/webhooks/[provider]/route.test.ts` in full first — mirror its exact mock/assertion style for the Campaign case. Add:

```typescript
describe('POST /api/webhooks/[provider] -- registration-linked (Trip Fee) payment', () => {
  it('paid: confirms the Registration, posts TRIP_BALANCE-bound legs, notifies the Volunteer, does not touch Campaign/Donation tables', async () => {
    // Arrange a PENDING Payment with registrationId set (donationId null),
    // include registration: { batch: { trip: ... } }. Assert:
    // - tx.registration.updateMany called with { status: 'PENDING' -> N/A;
    //   the predicate is on the REGISTRATION not payment } -- actually the
    //   predicate that matters is the Payment's own status-keyed updateMany
    //   (unchanged code), followed by a registration.updateMany setting
    //   status: 'CONFIRMED' (mirror the donation.update call's shape).
    // - tx.donation.update and tx.campaign.update are NOT called.
    // - paymentSettledLegs was posted with { type: 'trip', tripId: ... }.
    // - notifyRegistrationConfirmed was called (not notifyDonationConfirmed).
  });

  it('failed/expired: flips Registration.status to EXPIRED, posts nothing, does not touch Campaign/Donation tables', async () => {
    // Mirror the existing failed/expired Campaign test, asserting
    // registration.update sets status EXPIRED instead of
    // donation.update setting paymentStatus 'failed'.
  });

  it('no Platform Fee leg is ever posted against a Trip Fee settlement', async () => {
    // Assert postTransaction's leg array (however this file already
    // captures it -- a spy or the mocked ledgerEntry.createMany call)
    // contains no leg with account 'PLATFORM_FEE'.
  });

  it('every existing donation-linked (Campaign) test in this file still passes unchanged', async () => {
    // Not a new test -- reminder to run the existing suite after Step 8.
  });
});
```

(Sketched at the level of intent for the same reason as Task 3 Step 1 — this file's real fixture must be read and matched, not guessed at.)

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/webhooks/[provider]/route.test.ts`
Expected: FAIL — the Trip-branch assertions fail because the route doesn't branch yet.

- [ ] **Step 9: Implement the webhook's Trip branch**

Read `src/app/api/webhooks/[provider]/route.ts` in full before editing. The current code (as of this plan) does, around the payment lookup:

```typescript
const payment = await prisma.payment.findUnique({
  where: { providerRef: event.providerOrderId },
  include: { donation: { include: { campaign: true } } },
});
```

Change the `include` to fetch both possible subjects:

```typescript
const payment = await prisma.payment.findUnique({
  where: { providerRef: event.providerOrderId },
  include: {
    donation: { include: { campaign: true } },
    registration: { include: { batch: { include: { trip: true } } } },
  },
});
```

Replace the unconditional destructure:

```typescript
const { donation } = payment;
// Assumes a Campaign-linked Payment...
const { campaign } = donation;
```

with a branch that the rest of the function's `paid`/`failed` blocks each use:

```typescript
const isTripPayment = payment.registrationId != null;
```

Then, inside the `if (event.status === 'paid')` block, after the existing amount-mismatch check (unchanged) and provider-fee extraction (unchanged), branch the settlement transaction. The Campaign path is the EXISTING code, unindented and unchanged in behavior; the Trip path is new, structurally parallel, and skips the `collectedAmount`/target-met logic entirely (`VolunteerTrip` has no such field):

```typescript
      const settled = await prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING },
          data: {
            status: PaymentStatus.PAID,
            providerFee,
            rawPayload: event.rawPayload as Prisma.InputJsonValue,
            paidAt,
            escrowReleaseAt: releaseAt,
          },
        });

        if (updated.count === 0) {
          await tx.webhookEvent.update({ where: { id: webhookEventId }, data: { processedAt: new Date() } });
          return false;
        }

        if (isTripPayment) {
          const { registration } = payment;
          await tx.registration.updateMany({
            where: { id: registration!.id, status: 'HOLD' },
            data: { status: 'CONFIRMED' },
          });

          await postTransaction(
            tx,
            paymentSettledLegs({
              subject: { type: 'trip', tripId: registration!.batch.tripId },
              grossAmount: payment.amount,
              providerFee,
            }),
            { paymentId: payment.id, transactionId: `webhook:${event.provider}:${event.providerEventId}` },
          );
        } else {
          const { donation } = payment;
          const { campaign } = donation!;
          const newCollectedAmount = campaign.collectedAmount + payment.amount;
          const targetMet = newCollectedAmount >= campaign.targetAmount;

          await tx.donation.update({ where: { id: donation!.id }, data: { paymentStatus: 'confirmed' } });
          await tx.campaign.update({
            where: { id: campaign.id },
            data: {
              collectedAmount: { increment: payment.amount },
              ...(targetMet ? { status: 'completed', lifecycleStatus: toLifecycleStatus('completed') } : {}),
            },
          });
          await postTransaction(
            tx,
            paymentSettledLegs({ subject: { type: 'campaign', campaignId: campaign.id }, grossAmount: payment.amount, providerFee }),
            { paymentId: payment.id, transactionId: `webhook:${event.provider}:${event.providerEventId}` },
          );
        }

        await tx.webhookEvent.update({ where: { id: webhookEventId }, data: { processedAt: new Date() } });
        return true;
      });

      if (settled) {
        if (isTripPayment) {
          const { registration } = payment;
          await notifyRegistrationConfirmed({
            volunteerId: registration!.volunteerId,
            tripSlug: registration!.batch.trip.slug,
            tripTitle: registration!.batch.trip.title,
            amount: payment.amount,
          });
        } else {
          const { donation } = payment;
          const { campaign } = donation!;
          await notifyDonationConfirmed({
            donorId: donation!.donorId,
            creatorId: campaign.creatorId,
            campaignId: campaign.id,
            campaignTitle: campaign.title,
            amount: payment.amount,
          });
        }
      } else {
        console.error(/* unchanged */);
      }
```

(`newCollectedAmount`/`targetMet` move INSIDE the Campaign branch since they read `campaign`, which no longer exists unconditionally at the outer scope — this is a real structural move, not just an indent.)

For the `failed`/`expired` branch (the `else` at the top level), the same shape:

```typescript
    } else {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING },
          data: {
            status: event.status === 'expired' ? PaymentStatus.EXPIRED : PaymentStatus.FAILED,
            rawPayload: event.rawPayload as Prisma.InputJsonValue,
          },
        });

        if (updated.count === 0) {
          await tx.webhookEvent.update({ where: { id: webhookEventId }, data: { processedAt: new Date() } });
          return;
        }

        if (isTripPayment) {
          await tx.registration.updateMany({
            where: { id: payment.registration!.id, status: 'HOLD' },
            data: { status: 'EXPIRED' },
          });
        } else {
          await tx.donation.update({ where: { id: payment.donation!.id }, data: { paymentStatus: 'failed' } });
        }

        await tx.webhookEvent.update({ where: { id: webhookEventId }, data: { processedAt: new Date() } });
      });
    }
```

Add the import: `import { notifyRegistrationConfirmed } from '@/lib/notifications';` alongside the existing `notifyDonationConfirmed` import.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/webhooks/[provider]/route.test.ts`
Expected: PASS, every existing Campaign-linked test unchanged plus the new Trip-linked ones.

- [ ] **Step 11: Run the full suite to confirm no regression, and check that this task actually closed the tracked tsc errors it should**

Run: `npx vitest run`
Expected: PASS, baseline plus every test this task added, 0 failures.

Run: `npx tsc --noEmit`
Ticket 01's final review tracked 10 pre-existing errors across 4 files, each marked with a "Campaign-linked assumption" comment, because at that point nothing branched on `donationId`/`registrationId` — the code just assumed a Campaign every time. This task's whole point is to make `escrow.ts` and the webhook route actually branch correctly. Confirm the errors that were in `src/lib/money/escrow.ts` and `src/app/api/webhooks/[provider]/route.ts` specifically are now GONE (not just "no new ones added") — the explicit `payment.donationId ?`/`isTripPayment` branching this task adds should resolve TypeScript's uncertainty at each of those lines, since the non-null assertions (`donation!`, `registration!`) are now guarded by a real runtime check instead of an unguarded assumption. The two files' worth of errors tracked for `reconcile/route.ts` are Task 4's to close, not this task's — don't expect those gone yet.

- [ ] **Step 12: Commit**

```bash
git add src/lib/money/escrow.ts src/lib/money/escrow.test.ts src/app/api/webhooks/[provider]/route.ts src/app/api/webhooks/[provider]/route.test.ts src/lib/notifications.ts src/lib/notifications.test.ts
git commit -m "feat: settle Trip Fee payments -- releaseMaturedEscrow and the webhook's Trip branch

releaseMaturedEscrow's candidate query and per-payment lock target now
resolve either a Campaign or a Volunteer Trip subject; every existing
Campaign-linked call site updated to the new (breaking) subject-shaped
parameter with no behavior change. The settlement webhook branches on
whether a Payment's donationId or registrationId is set: the Trip branch
confirms the Registration, posts TRIP_BALANCE-bound legs, and sends the
new notifyRegistrationConfirmed -- with no Campaign-equivalent
collectedAmount/target-met update, since VolunteerTrip has no such field.
failed/expired flips Registration.status to EXPIRED, mirroring how the
Campaign branch flips Donation.paymentStatus to 'failed' for both provider
outcomes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```

---

### Task 4: Reconcile's `strandedEscrow` and `deferredEscrowWatchdog` Trip variants

**Files:**
- Modify: `src/app/api/admin/reconcile/route.ts`
- Modify: `src/app/api/admin/reconcile/route.test.ts`

**Interfaces:**
- Consumes: `Registration`/`RegistrationStatus` (Task 1). Independent of Tasks 2/3's own internals — only needs the schema.
- Produces: nothing consumed elsewhere in this plan (last task). The report gains `tripStrandedEscrow` and `tripDeferredEscrowWatchdog`, siblings of the existing `strandedEscrow`/`deferredEscrowWatchdog`, matching the naming convention Ticket 01 already established for `negativeBalances`/`tripNegativeBalances`.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler yang diekspor (`GET`), diimpor dan dipanggil langsung dengan `@/lib/prisma` di-mock, mengikuti gaya seam yang sudah dipakai di file ini (lihat kerja Ticket 01 pada file yang sama). Cakup SETIAP kondisi: payment Registration-linked dengan residual bukan nol (masuk tripStrandedEscrow), payment Registration-linked dengan residual nol (tidak masuk), payment Registration-linked yang deferred cukup lama (masuk tripDeferredEscrowWatchdog), dan pastikan tidak ada payment Campaign-linked yang bocor ke dua array baru ini atau sebaliknya.

- [ ] **Step 1: Write the failing tests**

Read `src/app/api/admin/reconcile/route.test.ts` in full first (its `makeTx`, `LedgerRow`/`PayoutRow`/`PaymentRow`/`RefundRow` types, and the existing `strandedEscrow`/`deferredEscrowWatchdog` tests) — this file was already touched by Ticket 01's own Task 3, so its fixture already understands `volunteerTripId` on `LedgerRow`/`PayoutRow` and the `matchesWhere` normalization fix. `PaymentRow` almost certainly still only has `campaignId: string` (required) from before Ticket 01 touched this file — check, and widen it to optional plus a `registrationId`/`tripId`-shaped field the fake's `payment.findMany` can resolve the same way `donation: { campaignId: p.campaignId }` already works, i.e. add a `registration: { batch: { tripId: p.volunteerTripId } }` shape when `p.volunteerTripId` is set instead of `p.campaignId`.

```typescript
describe('GET /api/admin/reconcile -- registration-linked (trip) payments', () => {
  it('reports a stranded registration-linked payment in tripStrandedEscrow, not strandedEscrow', async () => {
    // Arrange one released Payment fixture with volunteerTripId set instead
    // of campaignId, with a residual (released+refunded amounts don't sum
    // to creditedNet). Assert it appears in data.tripStrandedEscrow with a
    // volunteerTripId field, and data.strandedEscrow stays empty.
  });

  it('does not report a stranded registration-linked payment when residual is zero', async () => {
    // Same setup, released+refunded exactly equals creditedNet -- expect
    // tripStrandedEscrow empty.
  });

  it('reports a long-deferred registration-linked payment in tripDeferredEscrowWatchdog', async () => {
    // A PAID, unreleased payment whose escrowReleaseAt is older than
    // deferredEscrowWatchdogCutoff(), volunteerTripId set. Expect it in
    // tripDeferredEscrowWatchdog, not deferredEscrowWatchdog.
  });

  it('does not let a campaign-linked payment leak into either trip array', async () => {
    // A normal campaignId-linked released payment with a residual --
    // confirm it's in strandedEscrow only, never tripStrandedEscrow.
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/admin/reconcile/route.test.ts`
Expected: the 4 new tests FAIL (`tripStrandedEscrow`/`tripDeferredEscrowWatchdog` are `undefined`); every existing test still PASSES.

- [ ] **Step 3: Implement the route changes**

Read the current `strandedEscrow` block in full before editing (approximate shape as of this plan):

```typescript
const releasedPayments = await tx.payment.findMany({
  where: { escrowReleasedAt: { not: null } },
  select: {
    id: true,
    amount: true,
    providerFee: true,
    donation: { select: { campaignId: true } },
  },
});
```

Widen the `select` to also fetch the Trip-side path:

```typescript
const releasedPayments = await tx.payment.findMany({
  where: { escrowReleasedAt: { not: null } },
  select: {
    id: true,
    amount: true,
    providerFee: true,
    donationId: true,
    registrationId: true,
    donation: { select: { campaignId: true } },
    registration: { select: { batch: { select: { tripId: true } } } },
  },
});
```

Split the existing push loop into two arrays, branching per payment on which FK is set:

```typescript
const strandedEscrow: Array<{ paymentId: string; campaignId: string; creditedNet: number; releasedAmount: number; refundedAmount: number; residual: number }> = [];
const tripStrandedEscrow: Array<{ paymentId: string; volunteerTripId: string; creditedNet: number; releasedAmount: number; refundedAmount: number; residual: number }> = [];

for (const payment of releasedPayments) {
  const creditedNet = payment.amount - payment.providerFee;
  const releasedAmount = releasedAmountByPayment.get(payment.id) ?? 0;
  const refundedAmount = refundedAmountByPayment.get(payment.id) ?? 0;
  const residual = creditedNet - releasedAmount - refundedAmount;
  if (residual === 0) continue;

  if (payment.donationId) {
    strandedEscrow.push({ paymentId: payment.id, campaignId: payment.donation!.campaignId, creditedNet, releasedAmount, refundedAmount, residual });
  } else {
    tripStrandedEscrow.push({ paymentId: payment.id, volunteerTripId: payment.registration!.batch.tripId, creditedNet, releasedAmount, refundedAmount, residual });
  }
}
```

Do the same for `deferredEscrowCandidates`/`deferredEscrowWatchdog`:

```typescript
const deferredEscrowCandidates = await tx.payment.findMany({
  where: { status: 'PAID', escrowReleasedAt: null, escrowReleaseAt: { lte: deferredEscrowWatchdogCutoff() } },
  select: {
    id: true,
    escrowReleaseAt: true,
    donationId: true,
    registrationId: true,
    donation: { select: { campaignId: true } },
    registration: { select: { batch: { select: { tripId: true } } } },
    refunds: { select: { id: true, status: true } },
  },
});

const deferredEscrowWatchdog: Array<{ paymentId: string; campaignId: string; escrowReleaseAt: Date | null; refunds: Array<{ refundId: string; status: string }> }> = [];
const tripDeferredEscrowWatchdog: Array<{ paymentId: string; volunteerTripId: string; escrowReleaseAt: Date | null; refunds: Array<{ refundId: string; status: string }> }> = [];

for (const payment of deferredEscrowCandidates) {
  const row = {
    paymentId: payment.id,
    escrowReleaseAt: payment.escrowReleaseAt,
    refunds: payment.refunds.map((r) => ({ refundId: r.id, status: r.status })),
  };
  if (payment.donationId) {
    deferredEscrowWatchdog.push({ ...row, campaignId: payment.donation!.campaignId });
  } else {
    tripDeferredEscrowWatchdog.push({ ...row, volunteerTripId: payment.registration!.batch.tripId });
  }
}
```

Add both new arrays to the returned `report` object, next to their existing Campaign-side siblings:

```typescript
    return {
      generatedAt: new Date().toISOString(),
      unbalancedTransactions,
      negativeBalances,
      tripNegativeBalances,
      preLedger,
      caveat: /* unchanged */,
      mismatches,
      strandedEscrow,
      tripStrandedEscrow,
      deferredEscrowWatchdog,
      tripDeferredEscrowWatchdog,
      stuckPayouts: { /* unchanged */ },
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/admin/reconcile/route.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Run the full suite one final time, and confirm this task closed its share of the tracked tsc errors**

Run: `npx vitest run`
Expected: PASS, baseline plus every test this whole plan added, 0 failures. This is the plan's final regression gate.

Run: `npx tsc --noEmit`. Ticket 01's final review tracked pre-existing errors in `reconcile/route.ts` alongside `escrow.ts`/`payouts.ts`/`webhooks/[provider]/route.ts`, all from the same root cause (unguarded `payment.donation`-style assumptions). Task 3 should have already closed `escrow.ts`'s and the webhook route's share; this task's own explicit `payment.donationId ? ... : ...` branching in the `strandedEscrow`/`deferredEscrowWatchdog` blocks should close `reconcile/route.ts`'s share too. Confirm the total error count reflects that — report the before/after count in your final report rather than just "no new errors."

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/reconcile/route.ts src/app/api/admin/reconcile/route.test.ts
git commit -m "feat: reconcile report gains tripStrandedEscrow and tripDeferredEscrowWatchdog

Mirrors the existing Campaign-linked strandedEscrow/deferredEscrowWatchdog
checks exactly, resolving the subject via payment.registration.batch.tripId
instead of payment.donation.campaignId. Completes the reconcile
generalization the money-layer ticket started (it could only add
negativeBalances/stuckPayouts' trip variants then, since these two checks
need Registration/VolunteerBatch to resolve the subject, which now exist).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```

**Further notes, not a task — open parameters this plan does not resolve:**

- **The 30-minute hold window (Task 2, `HOLD_WINDOW_MS`) is a controller-chosen default, not a spec value.** PRD §13 lists the exact hold duration as still open. Treat it as a named constant easy to change later, not a value worth debating further in this plan.
- **`Payout.volunteerTripId` is still a plain scalar with no `@relation`**, left that way by Ticket 02 despite `VolunteerTrip` now existing. This plan does not fix it — it belongs to whichever ticket first builds a real Trip payout flow (Ticket 04 in the parent ticket set) and actually needs to `.include()` through it. Flagged here so it isn't silently forgotten a second time.
