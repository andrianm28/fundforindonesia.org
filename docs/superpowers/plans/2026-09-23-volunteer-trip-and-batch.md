# Volunteer Trip and Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fundraiser can create a Volunteer Trip and add Volunteer Batches to it, submit it for review, and see it go through the same kind of moderation a Campaign already does; a Verifier reviews it in its own queue; an approved Trip and its open Batches are visible on a public catalog and detail page.

**Architecture:** `VolunteerTrip` and `VolunteerBatch` are new, independent models — no change to `Campaign` or any Campaign route. Every route mirrors an existing Campaign route's real shape as closely as the product difference allows: `POST /api/campaigns` (create, `withRoleCheck`), `PATCH /api/campaigns/[slug]` (edit, inline ownership check), `POST /api/moderasi/campaigns/[id]` (moderation — actually `PATCH`, verified against the real file, not assumed from the ticket's wording). One deliberate deviation from Campaign's own `PATCH` precedent: Campaign's `PATCH` spreads the entire request body into the update (including `status`), which would let a Fundraiser self-publish by sending `status: "ACTIVE"` directly. Volunteer Trip's `PATCH` accepts only a fixed set of editable fields plus an `action: "submit"` flag — no client-supplied `status` value is ever accepted, closing the same gap rather than reproducing it. No money code is touched; this ticket is demoable end to end without a Trip Fee ever being collected.

**Tech Stack:** Next.js, Prisma, Postgres, Vitest, Zod.

**Spec:** .scratch/volunteer-trip/spec.md (ticket: .scratch/volunteer-trip/issues/02-volunteer-trip-and-batch.md)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    <akar specflow>/scripts/check-plan-headings.sh    <rencana ini> <task-brief>
    <akar specflow>/scripts/check-seam-constraints.sh <rencana ini> <task-brief>

## Global Constraints

- New `VolunteerTripStatus` enum: `DRAFT`, `SUBMITTED`, `REJECTED`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `COMPLETED`. No `EXPIRED`.
- New `VolunteerTrip` model, shaped like `Campaign` minus `targetAmount`/`deadline`/`isUrgent`/`isDemo`, plus `destination`/`itinerary`/`tripFeeAmount`.
- New `VolunteerBatchStatus` enum: `OPEN`, `CLOSED`, `CANCELLED`, `COMPLETED`. This plan only ever produces `OPEN`; model the full enum now so later tickets need no schema change.
- New `VolunteerBatch` model: start date, end date, registration deadline, max quota, min quota (Fundraiser-set per Batch, no platform-wide default), status, belongs to one `VolunteerTrip`.
- `POST /api/volunteer-trips` — an authenticated user with at least the `CAMPAIGN_CREATOR` role creates a `DRAFT` Trip they own.
- `PATCH /api/volunteer-trips/[slug]` — the owning Fundraiser (or an Admin) edits a `DRAFT`/`REJECTED` Trip, or submits it (→ `SUBMITTED`). No other status transition is ever accepted from the client.
- `POST /api/volunteer-trips/[slug]/batches` — the owning Fundraiser (or an Admin) adds a Batch to their own Trip.
- `PATCH /api/volunteer-trips/[slug]/batches/[id]` — the owning Fundraiser (or an Admin) edits a Batch while it's `OPEN`. No cancel action here — Batch cancellation for missing minimum quota is a later ticket's, because it has a refund consequence this ticket has nothing to fulfill it with.
- `GET /api/volunteer-trips` — public catalog, `ACTIVE` Trips only, no other status ever returned to an unauthenticated caller.
- `GET /api/volunteer-trips/[slug]` — public detail page, including the Trip's `OPEN` Batches.
- `GET /api/moderasi/volunteer-trips` — Verifier's queue of `SUBMITTED` Trips, its own dedicated endpoint (not a status-filter query param on the public catalog route, which stays public-only-ever-ACTIVE by construction).
- `PATCH /api/moderasi/volunteer-trips/[id]` — Verifier approves (→ `ACTIVE`) or rejects (→ `REJECTED`). No `suspend` action in this plan (Suspension is explicitly out of scope for this ticket).
- A non-owning Fundraiser cannot edit or submit someone else's Trip or Batch.
- A Trip cannot be submitted, and a Batch cannot be added, by anyone other than the owning Fundraiser or an Admin.
- Out of scope: `VolunteerTripStatus.SUSPENDED`/`CANCELLED`/`COMPLETED` transitions, `VolunteerBatchStatus.CLOSED`/`CANCELLED`/`COMPLETED` transitions, any money/`Registration`/Trip Fee code, English/i18n, structured itinerary data (it's free text, matching `Campaign.description`/`story`).

---

### Task 1: Schema — `VolunteerTrip` and `VolunteerBatch`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_volunteer_trip_and_batch/migration.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces: `VolunteerTrip` (fields: `id`, `slug`, `title`, `description`, `story`, `coverImage`, `destination`, `itinerary`, `tripFeeAmount`, `status: VolunteerTripStatus`, `fundraiserId`, `createdAt`, `updatedAt`, relations `fundraiser: User`, `batches: VolunteerBatch[]`) and `VolunteerBatch` (fields: `id`, `tripId`, `startDate`, `endDate`, `registrationDeadline`, `maxQuota`, `minQuota`, `status: VolunteerBatchStatus`, `createdAt`, `updatedAt`, relation `trip: VolunteerTrip`), which Tasks 2 and 3 both consume directly via `prisma.volunteerTrip`/`prisma.volunteerBatch`.

**Seam constraint (MENGIKAT task ini, dari spec):** Task ini tidak punya seam kode (murni skema + migrasi). Cakup SETIAP kolom dan enum yang didaftarkan di Global Constraints persis sesuai nama dan tipe di sana; tidak ada test untuk task ini selain memastikan `npx prisma generate` berhasil dan seluruh test suite yang sudah ada tetap hijau setelah migrasi.

- [ ] **Step 1: Add the two enums and two models to `prisma/schema.prisma`**

Add a new section at the end of the file (after the existing `DisbursementLegacy` model, which is currently the last thing in the file — confirm this is still true before appending, the file may have grown):

```prisma
// ==================== Volunteer Trip ====================

enum VolunteerTripStatus {
  DRAFT
  SUBMITTED
  REJECTED
  ACTIVE
  SUSPENDED
  CANCELLED
  COMPLETED
}

/// A Fundraiser-owned catalog item: destination, itinerary, and a Trip Fee
/// shared across every Batch of this Trip. Deliberately not a Campaign and
/// not a Kind -- see ADR 0014. Shaped like Campaign minus targetAmount/
/// deadline/isUrgent/isDemo, plus destination/itinerary/tripFeeAmount.
model VolunteerTrip {
  id            String              @id @default(cuid())
  slug          String              @unique
  title         String
  description   String              @db.Text
  story         String              @db.Text
  coverImage    String
  destination   String
  itinerary     String              @db.Text
  tripFeeAmount Int
  status        VolunteerTripStatus @default(DRAFT)
  fundraiserId  String
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt

  // Relations
  fundraiser User             @relation(fields: [fundraiserId], references: [id], onDelete: Cascade)
  batches    VolunteerBatch[]

  @@index([slug])
  @@index([status])
  @@index([fundraiserId])
}

enum VolunteerBatchStatus {
  OPEN
  CLOSED
  CANCELLED
  COMPLETED
}

/// One dated instance of a Volunteer Trip. maxQuota/minQuota are Fundraiser-
/// set per Batch, never a platform-wide constant (ADR 0014). This ticket
/// only ever produces OPEN; the rest of the enum exists so a later ticket
/// (Registration, Batch cancellation) needs no schema change to use it.
model VolunteerBatch {
  id                   String               @id @default(cuid())
  tripId               String
  startDate            DateTime
  endDate              DateTime
  registrationDeadline DateTime
  maxQuota             Int
  minQuota             Int
  status               VolunteerBatchStatus @default(OPEN)
  createdAt            DateTime             @default(now())
  updatedAt            DateTime             @updatedAt

  // Relations
  trip VolunteerTrip @relation(fields: [tripId], references: [id], onDelete: Cascade)

  @@index([tripId])
  @@index([status])
}
```

In the `User` model, add the back-relation alongside the existing `campaigns Campaign[]` line:

```prisma
  volunteerTrips VolunteerTrip[]
```

- [ ] **Step 2: Generate the Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client ... to ./src/generated/prisma`.

- [ ] **Step 3: Write the migration SQL**

Check first whether `DATABASE_URL` is reachable (`echo $DATABASE_URL`, try `npx prisma migrate dev --name add_volunteer_trip_and_batch`). If it succeeds, skip to Step 4. If there's no reachable database, hand-write `prisma/migrations/<YYYYMMDDHHMMSS>_add_volunteer_trip_and_batch/migration.sql` (timestamp later than the most recent existing migration directory — check `ls prisma/migrations/`), matching this repo's Prisma-generated style (see any existing migration file for the exact section-comment/quoting conventions):

```sql
-- CreateEnum
CREATE TYPE "VolunteerTripStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "VolunteerBatchStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "VolunteerTrip" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "coverImage" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "itinerary" TEXT NOT NULL,
    "tripFeeAmount" INTEGER NOT NULL,
    "status" "VolunteerTripStatus" NOT NULL DEFAULT 'DRAFT',
    "fundraiserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerBatch" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "registrationDeadline" TIMESTAMP(3) NOT NULL,
    "maxQuota" INTEGER NOT NULL,
    "minQuota" INTEGER NOT NULL,
    "status" "VolunteerBatchStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerTrip_slug_key" ON "VolunteerTrip"("slug");

-- CreateIndex
CREATE INDEX "VolunteerTrip_slug_idx" ON "VolunteerTrip"("slug");

-- CreateIndex
CREATE INDEX "VolunteerTrip_status_idx" ON "VolunteerTrip"("status");

-- CreateIndex
CREATE INDEX "VolunteerTrip_fundraiserId_idx" ON "VolunteerTrip"("fundraiserId");

-- CreateIndex
CREATE INDEX "VolunteerBatch_tripId_idx" ON "VolunteerBatch"("tripId");

-- CreateIndex
CREATE INDEX "VolunteerBatch_status_idx" ON "VolunteerBatch"("status");

-- AddForeignKey
ALTER TABLE "VolunteerTrip" ADD CONSTRAINT "VolunteerTrip_fundraiserId_fkey" FOREIGN KEY ("fundraiserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerBatch" ADD CONSTRAINT "VolunteerBatch_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "VolunteerTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

(`onDelete: Cascade` on both relations matches `Campaign.creator`'s existing `onDelete: Cascade` convention exactly — deleting a User deletes what they own, same as Campaign already does. Double-check this against `Campaign`'s actual FK definition in `prisma/migrations/` before treating it as settled, in case the convention differs from what this plan assumes.)

- [ ] **Step 4: Run the full existing test suite to confirm no regression from the schema addition alone**

Run: `npx vitest run`
Expected: PASS, same 119 files / 1210 tests as this plan's baseline — a pure schema addition with no application code reading or writing the new models yet must not break anything.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add VolunteerTrip and VolunteerBatch schema

New, independent models -- not a Campaign Kind (ADR 0014). VolunteerTrip
mirrors Campaign's shape minus targetAmount/deadline/isUrgent/isDemo, plus
destination/itinerary/tripFeeAmount. VolunteerBatch is one dated instance
of a Trip with its own Fundraiser-set max and min quota. Both status enums
are modeled with their full eventual value set now so later tickets (Batch
cancellation, Registration) need no further schema change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```

---

### Task 2: Fundraiser creates and edits a Trip and its Batches

**Files:**
- Create: `src/app/api/volunteer-trips/route.ts`
- Create: `src/app/api/volunteer-trips/route.test.ts`
- Create: `src/app/api/volunteer-trips/[slug]/route.ts`
- Create: `src/app/api/volunteer-trips/[slug]/route.test.ts`
- Create: `src/app/api/volunteer-trips/[slug]/batches/route.ts`
- Create: `src/app/api/volunteer-trips/[slug]/batches/route.test.ts`
- Create: `src/app/api/volunteer-trips/[slug]/batches/[id]/route.ts`
- Create: `src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts`

**Interfaces:**
- Consumes: `prisma.volunteerTrip`/`prisma.volunteerBatch` (Task 1), `withRoleCheck` (`src/lib/withRoleCheck.ts`), `isAtLeast` (`src/lib/roles.ts`), `getServerSession` (`src/lib/auth.ts`) — all existing, unmodified.
- Produces: nothing later tasks in this plan directly import (Task 3's routes are independent files), but Task 3's `GET /api/volunteer-trips/[slug]` reads the exact same `VolunteerBatch` rows this task creates, so the field names/shapes below are load-bearing for it.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler yang diekspor (`POST`/`PATCH`), diimpor dan dipanggil langsung dengan `@/lib/prisma` dan `@/lib/auth` di-mock, mengikuti gaya seam yang sudah dipakai untuk `campaigns/route.test.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: otentikasi, otorisasi peran, kepemilikan (owner vs bukan owner vs Admin), validasi input, transisi status yang diizinkan vs ditolak, dan jalur kegagalan (404, 400, 401, 403). Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests for `POST /api/volunteer-trips`**

```typescript
// src/app/api/volunteer-trips/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { POST } from './route';

const mockCreate = prisma.volunteerTrip.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

const VALID_BODY = {
  title: 'Mengajar di Pulau Terpencil',
  description: 'Deskripsi singkat trip.',
  story: 'Cerita lengkap trip.',
  coverImage: 'https://example.com/cover.jpg',
  destination: 'Pulau Terpencil, NTT',
  itinerary: 'Hari 1: berangkat. Hari 2-4: mengajar. Hari 5: pulang.',
  tripFeeAmount: 1_500_000,
};

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/volunteer-trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1', role: 'CAMPAIGN_CREATOR' } });
    mockCreate.mockResolvedValue({ id: 'trip-1', slug: 'mengajar-di-pulau-terpencil-ab12cd', ...VALID_BODY, status: 'DRAFT', fundraiserId: 'user-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 403 for a DONOR (below CAMPAIGN_CREATOR)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', role: 'DONOR' } });
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('allows an ADMIN (above CAMPAIGN_CREATOR in the hierarchy) to create a Trip', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(201);
  });

  it('creates a DRAFT Trip owned by the requester', async () => {
    const response = await POST(createRequest(VALID_BODY));
    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ...VALID_BODY,
          status: 'DRAFT',
          fundraiserId: 'user-1',
        }),
      }),
    );
  });

  it('returns 400 for a missing required field', async () => {
    const { title: _title, ...withoutTitle } = VALID_BODY;
    const response = await POST(createRequest(withoutTitle));
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-positive tripFeeAmount', async () => {
    const response = await POST(createRequest({ ...VALID_BODY, tripFeeAmount: 0 }));
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid coverImage URL', async () => {
    const response = await POST(createRequest({ ...VALID_BODY, coverImage: 'not-a-url' }));
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement `POST /api/volunteer-trips`**

```typescript
// src/app/api/volunteer-trips/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withRoleCheck } from '@/lib/withRoleCheck';

const createVolunteerTripSchema = z.object({
  title: z.string().min(1, 'Judul harus diisi').max(200, 'Judul maksimal 200 karakter'),
  description: z.string().min(1, 'Deskripsi harus diisi'),
  story: z.string().min(1, 'Cerita trip harus diisi'),
  coverImage: z.string().url('URL gambar tidak valid'),
  destination: z.string().min(1, 'Destinasi harus diisi'),
  itinerary: z.string().min(1, 'Itinerary harus diisi'),
  tripFeeAmount: z.number().positive('Trip Fee harus lebih dari 0'),
});

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  const suffix = Math.random().toString(36).substring(2, 8);
  return `${base}-${suffix}`;
}

export const POST = withRoleCheck('CAMPAIGN_CREATOR', async (request: NextRequest) => {
  try {
    const session = await getServerSession();

    const body = await request.json();
    const result = createVolunteerTripSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const slug = generateSlug(result.data.title);

    const trip = await prisma.volunteerTrip.create({
      data: {
        slug,
        ...result.data,
        fundraiserId: session!.user.id,
        status: 'DRAFT',
      },
    });

    return NextResponse.json(trip, { status: 201 });
  } catch (error) {
    console.error('Error creating volunteer trip:', error);
    return NextResponse.json({ error: 'Gagal membuat volunteer trip' }, { status: 500 });
  }
});
```

(`generateSlug` is deliberately duplicated from `src/app/api/campaigns/route.ts` rather than extracted to a shared module — this plan does not modify any Campaign file, including to extract a shared helper from it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/route.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Write the failing tests for `PATCH /api/volunteer-trips/[slug]`**

```typescript
// src/app/api/volunteer-trips/[slug]/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PATCH } from './route';

const mockFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockUpdate = prisma.volunteerTrip.update as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug') {
  return { params: Promise.resolve({ slug }) };
}

describe('PATCH /api/volunteer-trips/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'DRAFT' });
    mockUpdate.mockResolvedValue({ id: 'trip-1', status: 'DRAFT', title: 'Updated title' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent slug', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owning Fundraiser', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await PATCH(patchRequest({ title: 'x' }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('allows an ADMIN to edit a Trip they do not own', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
  });

  it('allows the owning Fundraiser to edit fields while DRAFT', async () => {
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Updated title' }) }),
    );
  });

  it('allows editing while REJECTED', async () => {
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'REJECTED' });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(200);
  });

  it('returns 400 when editing fields on an ACTIVE Trip', async () => {
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'ACTIVE' });
    const response = await PATCH(patchRequest({ title: 'Updated title' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('submits a DRAFT Trip: action "submit" sets status to SUBMITTED', async () => {
    const response = await PATCH(patchRequest({ action: 'submit' }), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    );
  });

  it('ignores a client-supplied status field entirely -- cannot be used to jump straight to ACTIVE', async () => {
    const response = await PATCH(patchRequest({ title: 'x', status: 'ACTIVE' }), routeContext());
    expect(response.status).toBe(200);
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  it('returns 400 for an unknown action value', async () => {
    const response = await PATCH(patchRequest({ action: 'publish' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `PATCH /api/volunteer-trips/[slug]`**

```typescript
// src/app/api/volunteer-trips/[slug]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { Role } from '@/generated/prisma/client';

const editVolunteerTripSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  story: z.string().min(1).optional(),
  coverImage: z.string().url().optional(),
  destination: z.string().min(1).optional(),
  itinerary: z.string().min(1).optional(),
  tripFeeAmount: z.number().positive().optional(),
  action: z.enum(['submit']).optional(),
});

const EDITABLE_STATUSES = ['DRAFT', 'REJECTED'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug } = await params;

    const trip = await prisma.volunteerTrip.findUnique({
      where: { slug },
      select: { id: true, fundraiserId: true, status: true },
    });

    if (!trip) {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const userRole = (session.user.role as Role) ?? 'DONOR';
    const isAdmin = userRole === 'ADMIN';
    const isOwner = isAtLeast(userRole, 'CAMPAIGN_CREATOR') && trip.fundraiserId === session.user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!EDITABLE_STATUSES.includes(trip.status)) {
      return NextResponse.json(
        { error: 'Trip tidak bisa diedit pada status ini' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const result = editVolunteerTripSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const { action, ...fields } = result.data;

    const updated = await prisma.volunteerTrip.update({
      where: { id: trip.id },
      data: {
        ...fields,
        ...(action === 'submit' ? { status: 'SUBMITTED' } : {}),
      },
    });

    return NextResponse.json({ trip: updated });
  } catch (error) {
    console.error('Error updating volunteer trip:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
```

Note what this deliberately does NOT do, versus `PATCH /api/campaigns/[slug]`: it never spreads the raw request body into `data`, and `status` is never assignable from client input — only `action: "submit"` can move status, and only to `SUBMITTED`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/route.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 9: Write the failing tests for `POST /api/volunteer-trips/[slug]/batches`**

```typescript
// src/app/api/volunteer-trips/[slug]/batches/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    volunteerBatch: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { POST } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockBatchCreate = prisma.volunteerBatch.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

const VALID_BATCH = {
  startDate: '2026-12-01T00:00:00.000Z',
  endDate: '2026-12-05T00:00:00.000Z',
  registrationDeadline: '2026-11-20T00:00:00.000Z',
  maxQuota: 20,
  minQuota: 8,
};

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/some-slug/batches', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(slug = 'some-slug') {
  return { params: Promise.resolve({ slug }) };
}

describe('POST /api/volunteer-trips/[slug]/batches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'DRAFT' });
    mockBatchCreate.mockResolvedValue({ id: 'batch-1', tripId: 'trip-1', ...VALID_BATCH, status: 'OPEN' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(401);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent trip slug', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(404);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-owning Fundraiser', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(403);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('creates an OPEN Batch for the owning Fundraiser', async () => {
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(201);
    expect(mockBatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tripId: 'trip-1', status: 'OPEN', maxQuota: 20, minQuota: 8 }),
      }),
    );
  });

  it('returns 400 when minQuota exceeds maxQuota', async () => {
    const response = await POST(createRequest({ ...VALID_BATCH, minQuota: 25 }), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when registrationDeadline is after startDate', async () => {
    const response = await POST(
      createRequest({ ...VALID_BATCH, registrationDeadline: '2026-12-02T00:00:00.000Z' }),
      routeContext(),
    );
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when endDate is before startDate', async () => {
    const response = await POST(
      createRequest({ ...VALID_BATCH, endDate: '2026-11-30T00:00:00.000Z' }),
      routeContext(),
    );
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-positive maxQuota', async () => {
    const response = await POST(createRequest({ ...VALID_BATCH, maxQuota: 0 }), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for adding a batch to a CANCELLED trip', async () => {
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'CANCELLED' });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(400);
    expect(mockBatchCreate).not.toHaveBeenCalled();
  });

  it('allows adding a batch to an ACTIVE trip', async () => {
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', status: 'ACTIVE' });
    const response = await POST(createRequest(VALID_BATCH), routeContext());
    expect(response.status).toBe(201);
  });
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/batches/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `POST /api/volunteer-trips/[slug]/batches`**

```typescript
// src/app/api/volunteer-trips/[slug]/batches/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { Role } from '@/generated/prisma/client';

const createBatchSchema = z
  .object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    registrationDeadline: z.string().datetime(),
    maxQuota: z.number().int().positive('maxQuota harus lebih dari 0'),
    minQuota: z.number().int().positive('minQuota harus lebih dari 0'),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: 'endDate tidak boleh sebelum startDate',
    path: ['endDate'],
  })
  .refine((data) => new Date(data.registrationDeadline) <= new Date(data.startDate), {
    message: 'registrationDeadline tidak boleh setelah startDate',
    path: ['registrationDeadline'],
  })
  .refine((data) => data.minQuota <= data.maxQuota, {
    message: 'minQuota tidak boleh melebihi maxQuota',
    path: ['minQuota'],
  });

// A Batch can be added to a Trip in any status except CANCELLED -- adding a
// new date to an already-approved Trip is a normal operation (opening a new
// intake for a recurring destination), and a Fundraiser filling in a Trip's
// details before first submitting it needs to add Batches too. A cancelled
// Trip is done; nothing should extend it. (Ruling: not explicitly settled by
// the ticket; this is the controller's call, recorded here rather than in a
// separate ledger since it's a small, self-contained decision.)
const BATCH_ADDABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'REJECTED', 'ACTIVE', 'SUSPENDED'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug } = await params;

    const trip = await prisma.volunteerTrip.findUnique({
      where: { slug },
      select: { id: true, fundraiserId: true, status: true },
    });

    if (!trip) {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const userRole = (session.user.role as Role) ?? 'DONOR';
    const isAdmin = userRole === 'ADMIN';
    const isOwner = isAtLeast(userRole, 'CAMPAIGN_CREATOR') && trip.fundraiserId === session.user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!BATCH_ADDABLE_STATUSES.includes(trip.status)) {
      return NextResponse.json(
        { error: 'Tidak bisa menambah batch pada trip dengan status ini' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const result = createBatchSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
    }

    const { startDate, endDate, registrationDeadline, maxQuota, minQuota } = result.data;

    const batch = await prisma.volunteerBatch.create({
      data: {
        tripId: trip.id,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        registrationDeadline: new Date(registrationDeadline),
        maxQuota,
        minQuota,
        status: 'OPEN',
      },
    });

    return NextResponse.json(batch, { status: 201 });
  } catch (error) {
    console.error('Error creating volunteer batch:', error);
    return NextResponse.json({ error: 'Gagal membuat volunteer batch' }, { status: 500 });
  }
}
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/batches/route.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 13: Write the failing tests for `PATCH /api/volunteer-trips/[slug]/batches/[id]`**

```typescript
// src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    volunteerBatch: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PATCH } from './route';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockBatchFindUnique = prisma.volunteerBatch.findUnique as unknown as Mock;
const mockBatchUpdate = prisma.volunteerBatch.update as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

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

describe('PATCH /api/volunteer-trips/[slug]/batches/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'owner-1', role: 'CAMPAIGN_CREATOR' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1' });
    mockBatchFindUnique.mockResolvedValue({ id: 'batch-1', tripId: 'trip-1', status: 'OPEN', maxQuota: 20, minQuota: 8 });
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

  it('ignores a client-supplied status field -- no cancel action exists on this route', async () => {
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
});
```

- [ ] **Step 14: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 15: Implement `PATCH /api/volunteer-trips/[slug]/batches/[id]`**

```typescript
// src/app/api/volunteer-trips/[slug]/batches/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { isAtLeast } from '@/lib/roles';
import { Role } from '@/generated/prisma/client';

const editBatchSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  registrationDeadline: z.string().datetime().optional(),
  maxQuota: z.number().int().positive().optional(),
  minQuota: z.number().int().positive().optional(),
});

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
      select: { id: true, tripId: true, status: true, maxQuota: true, minQuota: true },
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

Note: this route never accepts a `status` field from the client at all (not even filtered out explicitly — `editBatchSchema` simply has no `status` key, so Zod's `safeParse` silently drops it since the schema doesn't declare it, unlike Trip's `PATCH` which explicitly destructures `action` out). Confirm this actually holds — Zod's default parsing strips unknown keys unless `.passthrough()` is used, which this schema does not use; if that assumption is wrong for this Zod version, add an explicit `.strict()` or destructure `status` out the same way Trip's route does, and say so in your report.

- [ ] **Step 16: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/batches/[id]/route.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 17: Run the full suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS, baseline (119 files / 1210 tests) plus this task's ~36 new tests, 0 failures.

- [ ] **Step 18: Commit**

```bash
git add src/app/api/volunteer-trips
git commit -m "feat: Fundraiser creates and edits a Volunteer Trip and its Batches

POST /api/volunteer-trips (create, CAMPAIGN_CREATOR+), PATCH .../[slug]
(edit while DRAFT/REJECTED, or submit -- never a client-supplied status
jump straight to ACTIVE, unlike Campaign's own PATCH), POST .../batches
(add a Batch), PATCH .../batches/[id] (edit while OPEN, no cancel action --
that has a refund consequence a later ticket owns).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```

---

### Task 3: Public browsing and Verifier moderation

**Files:**
- Create: `src/app/api/volunteer-trips/route.ts` (extend with `GET`, alongside Task 2's `POST` in the same file)
- Create: `src/app/api/volunteer-trips/route.test.ts` (extend, alongside Task 2's `POST` tests)
- Create: `src/app/api/volunteer-trips/[slug]/route.ts` (extend with `GET`, alongside Task 2's `PATCH`)
- Create: `src/app/api/volunteer-trips/[slug]/route.test.ts` (extend)
- Create: `src/app/api/moderasi/volunteer-trips/route.ts`
- Create: `src/app/api/moderasi/volunteer-trips/route.test.ts`
- Create: `src/app/api/moderasi/volunteer-trips/[id]/route.ts`
- Create: `src/app/api/moderasi/volunteer-trips/[id]/route.test.ts`

**Interfaces:**
- Consumes: `prisma.volunteerTrip`/`prisma.volunteerBatch` (Task 1), `withAssignmentCheck`/`Assignment` (`src/lib/withAssignmentCheck.ts`, `@/generated/prisma/client`) — existing, unmodified. Reads the exact `VolunteerBatch` field names Task 2 writes (`maxQuota`, `status: 'OPEN'`, etc.).
- Produces: nothing later tasks in this plan consume (last task).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler yang diekspor (`GET`/`PATCH`), diimpor dan dipanggil langsung dengan `@/lib/prisma` dan `@/lib/auth` di-mock. Cakup SETIAP perilaku MELALUI seam itu: filter status publik (hanya ACTIVE pernah terlihat pengguna anonim), pagination, 404 untuk slug yang tidak ada, gerbang Assignment.VERIFIER pada kedua endpoint moderasi, dan aksi approve/reject. Nilai harapan dalam test harus literal yang diketahui.

- [ ] **Step 1: Write the failing tests for `GET /api/volunteer-trips`**

Append to `src/app/api/volunteer-trips/route.test.ts` (add `findMany`/`count` to the existing `vi.mock('@/lib/prisma', ...)` block's `volunteerTrip` object, alongside the existing `create`):

```typescript
// Add to the existing vi.mock('@/lib/prisma', ...) volunteerTrip object:
//   findMany: vi.fn(),
//   count: vi.fn(),

import { GET } from './route'; // add to the existing import line

const mockFindMany = prisma.volunteerTrip.findMany as unknown as Mock;
const mockCount = prisma.volunteerTrip.count as unknown as Mock;

function listRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/volunteer-trips${query}`);
}

describe('GET /api/volunteer-trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([{ id: 'trip-1', slug: 'trip-1', status: 'ACTIVE' }]);
    mockCount.mockResolvedValue(1);
  });

  it('only ever queries status ACTIVE, regardless of any query param', async () => {
    await GET(listRequest('?status=SUBMITTED'));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });

  it('returns paginated results with defaults', async () => {
    const response = await GET(listRequest());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual(expect.objectContaining({ trips: expect.any(Array), total: 1, page: 1 }));
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 12 }));
  });

  it('clamps an out-of-range limit to the maximum', async () => {
    await GET(listRequest('?limit=500'));
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('does not require authentication', async () => {
    const response = await GET(listRequest());
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/route.test.ts`
Expected: the 4 new tests FAIL (`GET` not exported); the existing `POST` tests from Task 2 still PASS.

- [ ] **Step 3: Implement `GET /api/volunteer-trips`**

Add to the existing `src/app/api/volunteer-trips/route.ts` (alongside the existing `POST` export — do not remove or modify it):

```typescript
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '12', 10)));
    const skip = (page - 1) * limit;

    // Always ACTIVE, never a client-controllable status filter -- this route
    // is public and unauthenticated. A SUBMITTED or DRAFT Trip is only ever
    // visible through the Verifier-gated /api/moderasi/volunteer-trips queue.
    const where = { status: 'ACTIVE' as const };

    const [trips, total] = await Promise.all([
      prisma.volunteerTrip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.volunteerTrip.count({ where }),
    ]);

    return NextResponse.json({
      trips,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error fetching volunteer trips:', error);
    return NextResponse.json({ error: 'Failed to fetch volunteer trips' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/route.test.ts`
Expected: PASS, all tests (Task 2's `POST` tests plus this step's 4 `GET` tests).

- [ ] **Step 5: Write the failing tests for `GET /api/volunteer-trips/[slug]`**

Append to `src/app/api/volunteer-trips/[slug]/route.test.ts` (add `volunteerBatch.findMany` to the mock block):

```typescript
// Add to the existing vi.mock('@/lib/prisma', ...) block:
//   volunteerBatch: { findMany: vi.fn() },

import { GET } from './route'; // add to the existing import line

const mockBatchFindMany = prisma.volunteerBatch.findMany as unknown as Mock;

function getRequest(slug = 'some-slug'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/volunteer-trips/${slug}`);
}

describe('GET /api/volunteer-trips/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({
      id: 'trip-1',
      slug: 'some-slug',
      status: 'ACTIVE',
      title: 'Mengajar di Pulau Terpencil',
    });
    mockBatchFindMany.mockResolvedValue([
      { id: 'batch-1', tripId: 'trip-1', status: 'OPEN', maxQuota: 20 },
    ]);
  });

  it('returns 404 for a nonexistent slug', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns the trip with its OPEN batches, each carrying a remainingQuota field', async () => {
    const response = await GET(getRequest(), routeContext());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.trip.slug).toBe('some-slug');
    expect(data.trip.batches).toEqual([
      expect.objectContaining({ id: 'batch-1', maxQuota: 20, remainingQuota: 20 }),
    ]);
    expect(mockBatchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tripId: 'trip-1', status: 'OPEN' }) }),
    );
  });

  it('does not require authentication', async () => {
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/route.test.ts`
Expected: the 3 new tests FAIL; the existing `PATCH` tests from Task 2 still PASS.

- [ ] **Step 7: Implement `GET /api/volunteer-trips/[slug]`**

Add to the existing `src/app/api/volunteer-trips/[slug]/route.ts` (alongside the existing `PATCH` export):

```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    const trip = await prisma.volunteerTrip.findUnique({ where: { slug } });

    if (!trip) {
      return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
    }

    const batches = await prisma.volunteerBatch.findMany({
      where: { tripId: trip.id, status: 'OPEN' },
      orderBy: { startDate: 'asc' },
    });

    // remainingQuota is always maxQuota here -- no Registration exists yet,
    // so HOLD+CONFIRMED is always 0. A later ticket subtracts the real count.
    const batchesWithRemaining = batches.map((batch) => ({
      ...batch,
      remainingQuota: batch.maxQuota,
    }));

    return NextResponse.json({ trip: { ...trip, batches: batchesWithRemaining } });
  } catch (error) {
    console.error('Error fetching volunteer trip:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 9: Write the failing tests for `GET /api/moderasi/volunteer-trips`**

```typescript
// src/app/api/moderasi/volunteer-trips/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { GET } from './route';

const mockFindMany = prisma.volunteerTrip.findMany as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function listRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/moderasi/volunteer-trips');
}

describe('GET /api/moderasi/volunteer-trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    mockFindMany.mockResolvedValue([{ id: 'trip-1', status: 'SUBMITTED' }]);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(listRequest());
    expect(response.status).toBe(401);
  });

  it('returns 403 for a user without the VERIFIER assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', role: 'MODERATOR', assignments: [] } });
    const response = await GET(listRequest());
    expect(response.status).toBe(403);
  });

  it('queries only SUBMITTED trips', async () => {
    await GET(listRequest());
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'SUBMITTED' }) }),
    );
  });

  it('returns the submitted trips', async () => {
    const response = await GET(listRequest());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.trips).toEqual([{ id: 'trip-1', status: 'SUBMITTED' }]);
  });
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/moderasi/volunteer-trips/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `GET /api/moderasi/volunteer-trips`**

```typescript
// src/app/api/moderasi/volunteer-trips/route.ts
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const GET = withAssignmentCheck(Assignment.VERIFIER, async (_req: NextRequest) => {
  const trips = await prisma.volunteerTrip.findMany({
    where: { status: 'SUBMITTED' },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ trips });
});
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/moderasi/volunteer-trips/route.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 13: Write the failing tests for `PATCH /api/moderasi/volunteer-trips/[id]`**

```typescript
// src/app/api/moderasi/volunteer-trips/[id]/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn(), update: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PATCH } from './route';

const mockFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockUpdate = prisma.volunteerTrip.update as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function actionRequest(action: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/moderasi/volunteer-trips/trip-1', {
    method: 'PATCH',
    body: JSON.stringify({ action }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext(id = 'trip-1') {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/moderasi/volunteer-trips/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    mockFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'owner-1', title: 'Trip title', slug: 'trip-slug' });
    mockUpdate.mockResolvedValue({ id: 'trip-1', status: 'ACTIVE', slug: 'trip-slug' });
    mockNotificationCreate.mockResolvedValue({});
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 for a user without the VERIFIER assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-2', role: 'MODERATOR', assignments: [] } });
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 for a nonexistent trip', async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid action', async () => {
    const response = await PATCH(actionRequest('suspend'), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('approve sets status to ACTIVE and notifies the Fundraiser', async () => {
    const response = await PATCH(actionRequest('approve'), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'trip-1' }, data: { status: 'ACTIVE' } }),
    );
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'owner-1' }) }),
    );
  });

  it('reject sets status to REJECTED and notifies the Fundraiser', async () => {
    mockUpdate.mockResolvedValue({ id: 'trip-1', status: 'REJECTED', slug: 'trip-slug' });
    const response = await PATCH(actionRequest('reject'), routeContext());
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'trip-1' }, data: { status: 'REJECTED' } }),
    );
    expect(mockNotificationCreate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 14: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/moderasi/volunteer-trips/[id]/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 15: Implement `PATCH /api/moderasi/volunteer-trips/[id]`**

```typescript
// src/app/api/moderasi/volunteer-trips/[id]/route.ts
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

const VALID_ACTIONS = ['approve', 'reject'] as const;
type ModerationAction = (typeof VALID_ACTIONS)[number];

const ACTION_STATUS_MAP: Record<ModerationAction, 'ACTIVE' | 'REJECTED'> = {
  approve: 'ACTIVE',
  reject: 'REJECTED',
};

const ACTION_MESSAGE_MAP: Record<ModerationAction, string> = {
  approve: 'Volunteer Trip Anda telah disetujui dan kini aktif',
  reject: 'Volunteer Trip Anda ditolak oleh moderator',
};

export const PATCH = withAssignmentCheck(Assignment.VERIFIER, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { action } = body;

  if (!action || !VALID_ACTIONS.includes(action as ModerationAction)) {
    return NextResponse.json(
      { error: 'Invalid action. Must be one of: approve, reject' },
      { status: 400 },
    );
  }

  const trip = await prisma.volunteerTrip.findUnique({
    where: { id },
    select: { id: true, fundraiserId: true, title: true },
  });

  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }

  const validAction = action as ModerationAction;
  const newStatus = ACTION_STATUS_MAP[validAction];

  const updatedTrip = await prisma.volunteerTrip.update({
    where: { id },
    data: { status: newStatus },
  });

  await prisma.notification.create({
    data: {
      type: 'volunteer_trip_moderation',
      title: 'Volunteer Trip Moderation Update',
      message: ACTION_MESSAGE_MAP[validAction],
      userId: trip.fundraiserId,
      link: `/volunteer-trip/${updatedTrip.slug}`,
    },
  });

  return NextResponse.json({ trip: updatedTrip });
});
```

- [ ] **Step 16: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/moderasi/volunteer-trips/[id]/route.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 17: Run the full suite one final time**

Run: `npx vitest run`
Expected: PASS, baseline (119 files / 1210 tests) plus every test this whole plan added, 0 failures. This is the plan's final regression gate.

- [ ] **Step 18: Commit**

```bash
git add src/app/api/volunteer-trips src/app/api/moderasi/volunteer-trips
git commit -m "feat: public Volunteer Trip catalog and Verifier moderation queue

GET /api/volunteer-trips and GET /api/volunteer-trips/[slug] are public,
unauthenticated, and only ever return ACTIVE trips -- no client-controllable
status filter, unlike Campaign's own public listing route, which accepts an
arbitrary status query param with no auth gate at all. GET and PATCH
/api/moderasi/volunteer-trips[/[id]] give a Verifier their own queue,
separate from the Campaign one, mirroring the real (PATCH, not POST, no
free-text reason field) shape of POST /api/moderasi/campaigns/[id] rather
than the ticket's own paraphrase of it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XeUKYBKfkM1h9xw9ANqA2J"
```
