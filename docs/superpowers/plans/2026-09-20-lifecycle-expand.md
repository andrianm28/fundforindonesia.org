# Campaign Lifecycle Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Campaign a real lifecycle enum alongside the legacy string column, backfilled and dual-written by every writer, with no reader changes.

**Architecture:** Expand phase of an expand-contract migration (tickets 02 to 05). A `CampaignStatus` enum and a `lifecycleStatus` column land beside the `status` string; one migration adds the column and backfills the six legacy strings; all five writers (four routes plus the seed) go through a single mapper so the two columns cannot diverge. Readers keep reading the string until tickets 03-05.

**Tech Stack:** Next.js 14 App Router, Prisma, Postgres, Vitest.

**Spec:** `.scratch/prd-compliance-fase-0-2/spec.md` (ticket `.scratch/prd-compliance-fase-0-2/issues/02-lifecycle-expand.md`)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    ~/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-20-lifecycle-expand.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief
    ~/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-20-lifecycle-expand.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- The lifecycle enum values are exactly `DRAFT`, `SUBMITTED`, `REJECTED`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `COMPLETED`, `EXPIRED`.
- The legacy-to-enum mapping below is verbatim and is used identically by the migration SQL, the mapper, and the seed: `pending` to `SUBMITTED`; `active` to `ACTIVE`; `rejected` to `REJECTED`; `suspended` to `SUSPENDED`; `completed` to `COMPLETED`; `expired` to `EXPIRED`. `DRAFT` and `CANCELLED` have no legacy source and appear nowhere in this ticket.
- Every write that sets the old string also sets the enum, so the two cannot diverge.
- No reader changes in this ticket: every read keeps reading the `status` string exactly as today.
- Donation acceptance behavior is unchanged; enforcing acceptance on the enum belongs to later tickets.
- `lifecycleStatus` defaults to `SUBMITTED`, because the only create path makes `pending` campaigns.
- All amounts are integer rupiah. Never introduce a float into a money path.
- The ledger is append-only: rows are added, never updated or deleted.
- Out of scope, do not build: migrating any reader to the enum (tickets 03-05); dropping or renaming the `status` string column (contract, ticket 05); Kind, Collecting Entity, Fundraising Permit, VerificationRequest; any admin lifecycle UI; any change to the payment provider layer, escrow, payouts, refunds, or fees.

---

### Task 1: Add the enum, the column, and the backfill migration

**Files:**
- Modify: `prisma/schema.prisma` — add the `CampaignStatus` enum block, the `lifecycleStatus` column on `Campaign`, and its index
- Create: a Prisma migration under `prisma/migrations/` (structural DDL plus six hand-written backfill `UPDATE`s)
- Create: `src/__tests__/lifecycle-migration.test.ts` — asserts the migration SQL content

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `prisma.lifecycleStatus` on the generated client with default `SUBMITTED`; the migration SQL other tasks rely on for the backfill story. Task 2 imports the `CampaignStatus` enum value from `@/generated/prisma/client`.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the migration SQL under prisma/migrations/ and prisma/schema.prisma, read as text`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode. Skema ini tidak punya permukaan HTTP, jadi tidak ada route handler yang diuji di sini; regresinya adalah full suite yang tetap hijau karena semua reader masih membaca string.

- [ ] **Step 1: Add the enum and column to the schema**

In `prisma/schema.prisma`, immediately above `model Campaign`, add:

```prisma
enum CampaignStatus {
  DRAFT
  SUBMITTED
  REJECTED
  ACTIVE
  SUSPENDED
  CANCELLED
  COMPLETED
  EXPIRED
}
```

On `model Campaign`, directly below the existing status line
`status          String    @default("active") // "active" | "completed" | "expired"`,
add exactly:

```prisma
  lifecycleStatus CampaignStatus @default(SUBMITTED)
```

Leave the `status` line byte-identical. In the same model's `@@index` block,
below `@@index([status])`, add exactly:

```prisma
  @@index([lifecycleStatus])
```

- [ ] **Step 2: Create the migration with the backfill**

Run:

```bash
npx prisma migrate dev --name add_campaign_lifecycle --create-only
```

There is no live database in this environment, so if that command refuses,
generate the structural SQL offline instead:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/lifecycle_struct.sql
```

Either way, the committed `migration.sql` must contain exactly these statements
(the DDL lines from the generator plus the six backfill lines below, in this order):

```sql
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "lifecycleStatus" "CampaignStatus" NOT NULL DEFAULT 'SUBMITTED';

-- Backfill the new column from the legacy string values
UPDATE "Campaign" SET "lifecycleStatus" = 'SUBMITTED' WHERE "status" = 'pending';
UPDATE "Campaign" SET "lifecycleStatus" = 'ACTIVE' WHERE "status" = 'active';
UPDATE "Campaign" SET "lifecycleStatus" = 'REJECTED' WHERE "status" = 'rejected';
UPDATE "Campaign" SET "lifecycleStatus" = 'SUSPENDED' WHERE "status" = 'suspended';
UPDATE "Campaign" SET "lifecycleStatus" = 'COMPLETED' WHERE "status" = 'completed';
UPDATE "Campaign" SET "lifecycleStatus" = 'EXPIRED' WHERE "status" = 'expired';

-- CreateIndex
CREATE INDEX "Campaign_lifecycleStatus_idx" ON "Campaign"("lifecycleStatus");
```

Read the file back. It MUST NOT contain `DROP COLUMN "status"`, MUST NOT
alter the `"status"` column, and MUST NOT mention `donationBalance`. If it does,
STOP and report — that violates a Global Constraint.

- [ ] **Step 3: Write the migration-content test**

Create `src/__tests__/lifecycle-migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function lifecycleMigrationSql(): string {
  const dir = "prisma/migrations";
  const match = readdirSync(dir).filter((d) =>
    d.endsWith("_add_campaign_lifecycle")
  );
  expect(match).toHaveLength(1);
  return readFileSync(join(dir, match[0], "migration.sql"), "utf8");
}

describe("campaign lifecycle backfill migration", () => {
  it("adds the column with the SUBMITTED default", () => {
    const sql = lifecycleMigrationSql();
    expect(sql).toContain(
      'ADD COLUMN "lifecycleStatus" "CampaignStatus" NOT NULL DEFAULT \'SUBMITTED\''
    );
  });

  it("backfills all six legacy strings to their enum values", () => {
    const sql = lifecycleMigrationSql();
    expect(sql).toContain(
      `"lifecycleStatus" = 'SUBMITTED' WHERE "status" = 'pending'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'ACTIVE' WHERE "status" = 'active'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'REJECTED' WHERE "status" = 'rejected'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'SUSPENDED' WHERE "status" = 'suspended'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'COMPLETED' WHERE "status" = 'completed'`
    );
    expect(sql).toContain(
      `"lifecycleStatus" = 'EXPIRED' WHERE "status" = 'expired'`
    );
  });

  it("never drops or alters the legacy string column", () => {
    const sql = lifecycleMigrationSql();
    expect(sql).not.toContain('DROP COLUMN "status"');
    expect(sql).not.toContain('ALTER COLUMN "status"');
  });
});
```

- [ ] **Step 4: Regenerate the client and typecheck**

```bash
npx prisma generate
npx tsc --noEmit 2>&1 | grep -i "lifecycle" || echo "no type errors naming lifecycleStatus"
```

Expected: `no type errors naming lifecycleStatus`. The repo has a pre-existing
backlog of type errors unrelated to this work; only errors naming the new
column or enum matter here.

- [ ] **Step 5: Run the migration test and the full suite**

Run: `npx vitest run src/__tests__/lifecycle-migration.test.ts`
Expected: PASS, 3 tests.

Run: `npx vitest run`
Expected: PASS, 95 files, no FAIL. Readers still use the string, so nothing
else may change behavior.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add CampaignStatus enum, column, and backfill migration

The lifecycle enum lands beside the legacy status string with a data
migration mapping all six legacy values. No writer sets it yet and no
reader reads it; that is the next tasks' work."
```

### Task 2: Central mapper plus the create path and the seed

**Files:**
- Create: `src/lib/campaign-lifecycle.ts` — the single string-to-enum mapper
- Modify: `src/app/api/campaigns/route.ts:145` — set `lifecycleStatus` next to `status: 'pending'`
- Modify: `prisma/seed.ts:287` — set `lifecycleStatus` next to `status: campaignData.status`
- Modify: `src/app/api/campaigns/route.test.ts` — add the dual-write creation case

**Interfaces:**
- Consumes: Task 1's enum and column on the generated client.
- Produces: `toLifecycleStatus(status: string): CampaignStatus` in
  `@/lib/campaign-lifecycle`, which Tasks 3 and 4 use for every other writer.
  Its contract: maps exactly the six legacy strings per the Global
  Constraints table; throws `Error("Unknown legacy campaign status: ...")`
  on anything else.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported POST handler of src/app/api/campaigns/route.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal (`toLifecycleStatus`) diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing test**

In `src/app/api/campaigns/route.test.ts`, inside the existing
`describe('POST /api/campaigns')` block (mirroring that file's session mock
and `mockCreate` pattern), add:

```typescript
it('sets lifecycleStatus SUBMITTED next to status pending on create', async () => {
  mockGetServerSession.mockResolvedValue({
    user: { id: 'user-1', name: 'Creator', email: 'creator@test.com' },
  });
  mockCreate.mockResolvedValue({ id: 'campaign-1' } as never);

  const request = new NextRequest('http://localhost:3000/api/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Bantu Korban Banjir',
      description: 'Banjir bandang merendam desa',
      story: 'Cerita lengkap kebutuhan dana',
      targetAmount: 50000000,
      category: 'bencana-alam',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const response = await POST(request);

  expect(response.status).toBe(201);
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'pending',
        lifecycleStatus: 'SUBMITTED',
      }),
    })
  );
});
```

If the file's existing POST cases use a different body shape or session shape,
copy their shapes and keep only the two asserted fields above literal.

Run: `npx vitest run src/app/api/campaigns/route.test.ts`
Expected: FAIL on the new case — `lifecycleStatus` is missing from the create
data. That failure is the RED.

- [ ] **Step 2: Create the mapper**

Create `src/lib/campaign-lifecycle.ts` with exactly this content:

```typescript
import { CampaignStatus } from "@/generated/prisma/client";

/**
 * Single source of the legacy-string to lifecycle-enum mapping.
 * Every writer that sets the `status` string sets `lifecycleStatus`
 * through this function, so the two columns cannot diverge.
 *
 * Unknown strings throw rather than map to a default: writing a
 * lifecycle state that is not one of the six known legacy values
 * must fail loudly, never silently land somewhere plausible.
 */
const STRING_TO_LIFECYCLE: Record<string, CampaignStatus> = {
  pending: CampaignStatus.SUBMITTED,
  active: CampaignStatus.ACTIVE,
  rejected: CampaignStatus.REJECTED,
  suspended: CampaignStatus.SUSPENDED,
  completed: CampaignStatus.COMPLETED,
  expired: CampaignStatus.EXPIRED,
};

export function toLifecycleStatus(status: string): CampaignStatus {
  const mapped = STRING_TO_LIFECYCLE[status];
  if (!mapped) {
    throw new Error(
      `Unknown legacy campaign status: ${JSON.stringify(status)}`
    );
  }
  return mapped;
}
```

- [ ] **Step 3: Wire the create path and the seed**

In `src/app/api/campaigns/route.ts`, add the import next to the other `@/lib`
imports:

```typescript
import { toLifecycleStatus } from "@/lib/campaign-lifecycle";
```

and change line 145 from:

```typescript
        status: 'pending',
```

to:

```typescript
        status: 'pending',
        lifecycleStatus: toLifecycleStatus('pending'),
```

In `prisma/seed.ts`, add the same import (relative path as that file uses for
other lib imports) and change line 287 from:

```typescript
        status: campaignData.status,
```

to:

```typescript
        status: campaignData.status,
        lifecycleStatus: toLifecycleStatus(campaignData.status),
```

The seed cannot run in tests (it needs a database); `tsc` in Step 4 and the
Task 5 guard cover it. Do not import the seed anywhere to test it.

- [ ] **Step 4: Run the tests, typecheck, and full suite**

Run: `npx vitest run src/app/api/campaigns/route.test.ts`
Expected: PASS, including the new case.

Run:

```bash
npx tsc --noEmit 2>&1 | grep -i "lifecycle" || echo "no type errors naming lifecycleStatus"
```

Expected: `no type errors naming lifecycleStatus`.

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: dual-write lifecycleStatus on campaign create and seed

POST /api/campaigns and prisma/seed.ts set lifecycleStatus through the new
toLifecycleStatus mapper next to the legacy status string. Readers are
untouched."
```

### Task 3: Dual-write the moderation writer

**Files:**
- Modify: `src/app/api/moderasi/campaigns/[id]/route.ts` — set `lifecycleStatus` next to `status: newStatus`
- Create: `src/app/api/moderasi/campaigns/[id]/route.test.ts` — approve/reject/suspend dual-write cases

**Interfaces:**
- Consumes: Task 2's `toLifecycleStatus`.
- Produces: the moderation writer sets both columns. Task 5's guard relies on
  this file mentioning `lifecycleStatus`.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported PATCH handler of src/app/api/moderasi/campaigns/[id]/route.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal (`toLifecycleStatus`) diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/moderasi/campaigns/[id]/route.test.ts`. The route is
wrapped in `withRoleCheck("MODERATOR", ...)`; mock that wrapper as a
passthrough so the test exercises the real handler logic at the exported
`PATCH` seam:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/withRoleCheck', () => ({
  withRoleCheck: (_role: string, handler: unknown) => handler,
}));

import { PATCH } from './route';
import { prisma } from '@/lib/prisma';

const mockFindUnique = vi.mocked(prisma.campaign.findUnique);
const mockUpdate = vi.mocked(prisma.campaign.update);

function patchRequest(action: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/moderasi/campaigns/campaign-1', {
    method: 'PATCH',
    body: JSON.stringify({ action }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function patchContext() {
  return { params: Promise.resolve({ id: 'campaign-1' }) };
}

describe('PATCH /api/moderasi/campaigns/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({
      id: 'campaign-1',
      creatorId: 'creator-1',
      title: 'Bantu Korban Banjir',
    } as never);
    mockUpdate.mockImplementation(async (args: unknown) => ({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      ...(args as { data: Record<string, unknown> }).data,
    }) as never);
  });

  it('approve sets status active and lifecycleStatus ACTIVE', async () => {
    const response = await PATCH(patchRequest('approve'), patchContext());

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'campaign-1' },
        data: expect.objectContaining({
          status: 'active',
          lifecycleStatus: 'ACTIVE',
        }),
      })
    );
  });

  it('reject sets status rejected and lifecycleStatus REJECTED', async () => {
    const response = await PATCH(patchRequest('reject'), patchContext());

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          lifecycleStatus: 'REJECTED',
        }),
      })
    );
  });

  it('suspend sets status suspended and lifecycleStatus SUSPENDED', async () => {
    const response = await PATCH(patchRequest('suspend'), patchContext());

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'suspended',
          lifecycleStatus: 'SUSPENDED',
        }),
      })
    );
  });
});
```

Run: `npx vitest run src/app/api/moderasi/campaigns/\[id\]/route.test.ts`
Expected: FAIL on all three cases — the update data has no `lifecycleStatus`.

- [ ] **Step 2: Wire the writer**

In `src/app/api/moderasi/campaigns/[id]/route.ts`, add the import:

```typescript
import { toLifecycleStatus } from "@/lib/campaign-lifecycle";
```

and change:

```typescript
    data: { status: newStatus },
```

to:

```typescript
    data: { status: newStatus, lifecycleStatus: toLifecycleStatus(newStatus) },
```

`newStatus` comes from `ACTION_STATUS_MAP`, whose values are exactly
`active`, `rejected`, `suspended` — all six-map keys — so the mapper cannot
throw here.

- [ ] **Step 3: Run the tests and the full suite**

Run: `npx vitest run src/app/api/moderasi/campaigns/\[id\]/route.test.ts`
Expected: PASS, 3 tests.

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: dual-write lifecycleStatus on moderation decisions

Approve, reject and suspend set lifecycleStatus through toLifecycleStatus
next to the legacy string. Readers are untouched."
```

### Task 4: Dual-write the edit path and the settlement path

**Files:**
- Modify: `src/app/api/campaigns/[slug]/route.ts` — map a `status` in the PATCH body to `lifecycleStatus`
- Modify: `src/app/api/campaigns/[slug]/route.test.ts` — add the passthrough case
- Modify: `src/app/api/webhooks/[provider]/route.ts` — set `lifecycleStatus` next to the `completed` write
- Modify: `src/app/api/webhooks/[provider]/route.test.ts` — extend the completion case

**Interfaces:**
- Consumes: Task 2's `toLifecycleStatus`.
- Produces: every writer in `src/` sets both columns. Task 5's guard relies on
  both files mentioning `lifecycleStatus`.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported PATCH handler of src/app/api/campaigns/[slug]/route.ts` dan `the exported POST handler of src/app/api/webhooks/[provider]/route.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal (`toLifecycleStatus`) diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing slug test**

In `src/app/api/campaigns/[slug]/route.test.ts`, inside the existing PATCH
describe block (mirroring that file's mocks), add:

```typescript
it('maps a status in the body to lifecycleStatus next to it', async () => {
  const response = await PATCH(
    patchRequest('bantu-korban-banjir', { status: 'suspended' }),
    patchContext('bantu-korban-banjir')
  );

  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'suspended',
        lifecycleStatus: 'SUSPENDED',
      }),
    })
  );
});
```

Copy the file's existing `patchRequest`/`patchContext` helper shapes and
session mock; only the asserted payload above is literal. If the file names
its update mock differently, use that name.

Run: `npx vitest run "src/app/api/campaigns/[slug]/route.test.ts"`
Expected: FAIL — the update data carries the raw body with no
`lifecycleStatus`.

- [ ] **Step 2: Write the failing webhook assertion**

In `src/app/api/webhooks/[provider]/route.test.ts`, extend the existing
`[M5 webhook] should mark campaign as completed when collectedAmount meets
targetAmount` case (which already drives `targetMet` true) with:

```typescript
expect(tx.campaign.update).toHaveBeenCalledWith({
  where: { id: 'campaign-webhook-1' },
  data: {
    collectedAmount: { increment: 75_000 },
    status: 'completed',
    lifecycleStatus: 'COMPLETED',
  },
});
```

replacing its current `data` expectation that lacks `lifecycleStatus`.
(This case currently asserts `status: 'completed'` in the update; keep that
line and add the `lifecycleStatus` line. If the file's exact expectation text
differs, keep its shape and add only the one line.)

Run: `npx vitest run "src/app/api/webhooks/[provider]/route.test.ts"`
Expected: FAIL — the update data has no `lifecycleStatus`.

- [ ] **Step 3: Wire both writers**

In `src/app/api/campaigns/[slug]/route.ts`, add the import:

```typescript
import { toLifecycleStatus } from "@/lib/campaign-lifecycle";
```

and change:

```typescript
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaign.id },
      data: body,
```

to:

```typescript
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        ...body,
        ...(typeof body.status === "string"
          ? { lifecycleStatus: toLifecycleStatus(body.status) }
          : {}),
      },
```

An unknown status string now throws inside the mapper and the request fails
instead of persisting two columns that disagree. That fail-loud behavior is
deliberate: silently diverging the columns would break the Global
Constraints. Bodies without a `status` field behave exactly as before.

In `src/app/api/webhooks/[provider]/route.ts`, add the same import and change:

```typescript
            ...(targetMet ? { status: 'completed' } : {}),
```

to:

```typescript
            ...(targetMet
              ? {
                  status: 'completed',
                  lifecycleStatus: toLifecycleStatus('completed'),
                }
              : {}),
```

When the target is not met neither column is written, so the two stay in
lockstep by construction.

- [ ] **Step 4: Run the tests and the full suite**

Run: `npx vitest run "src/app/api/campaigns/[slug]/route.test.ts" "src/app/api/webhooks/[provider]/route.test.ts"`
Expected: PASS, including the new and extended cases.

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere. Record the final test and file counts
for the commit message.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: dual-write lifecycleStatus on edit and settlement

PATCH /api/campaigns/[slug] maps a status in the body through
toLifecycleStatus, and the settled-payment webhook sets COMPLETED next to
completed. Unknown status strings now fail loudly instead of diverging the
columns. Readers are untouched."
```

### Task 5: Guard the dual-write so no writer can diverge the columns

**Files:**
- Create: `src/__tests__/properties/campaign-status-dual-write.test.ts`
- Modify: nothing else

**Interfaces:**
- Consumes: Tasks 1 through 4 — every writer must already set both columns,
  or this test fails by design.
- Produces: a standing guard. Any future route, job, or script that writes a
  Campaign without `lifecycleStatus` fails this test until the writer is
  fixed. Tickets 03-05 migrate readers under this guard.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the source tree under src/ plus prisma/seed.ts, read as text`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Properti yang diassert — tidak ada writer lain — tidak bisa diobservasi dengan memanggil satu handler pun, jadi pemindaian pohon sumber adalah seam yang benar, mengikuti preseden guard ticket 01. Daftar file yang diharuskan menyebut enum adalah literal yang diketahui, bukan sesuatu yang dihitung ulang oleh test.

- [ ] **Step 1: Write the guard test**

Create `src/__tests__/properties/campaign-status-dual-write.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The `status` string and the `lifecycleStatus` enum must never diverge:
 * every write that sets one sets the other through `toLifecycleStatus`.
 * This test exists so a new writer cannot reintroduce a silent split.
 *
 * There is no allowlist: today every Campaign write in src/ sets both
 * columns. If a future write legitimately cannot (it must not), add it
 * here as a named literal that a reviewer sees in the diff.
 */
const WRITE = /(prisma|tx)\.campaign\.(create|update)\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("Campaign status dual-write", () => {
  it("every src file that writes a Campaign also writes lifecycleStatus", () => {
    const offenders = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => WRITE.test(readFileSync(file, "utf8")))
      .filter((file) => !readFileSync(file, "utf8").includes("lifecycleStatus"));

    expect(offenders).toEqual([]);
  });

  it("the seed writes lifecycleStatus", () => {
    expect(readFileSync("prisma/seed.ts", "utf8")).toContain("lifecycleStatus");
  });

  it("no reader has moved to the enum yet", () => {
    const readers = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => readFileSync(file, "utf8").includes("lifecycleStatus"));

    expect(readers.sort()).toEqual(
      [
        "src/app/api/campaigns/[slug]/route.ts",
        "src/app/api/campaigns/route.ts",
        "src/app/api/moderasi/campaigns/[id]/route.ts",
        "src/app/api/webhooks/[provider]/route.ts",
        "src/lib/campaign-lifecycle.ts",
      ].sort()
    );
  });
});
```

The third case pins the ticket's scope: only the four writers plus the mapper
may mention the enum. Tickets 03-05 will extend this literal as they migrate
readers, one deliberate diff at a time.

- [ ] **Step 2: Run the test to verify it passes on the wired tree**

Run: `npx vitest run src/__tests__/properties/campaign-status-dual-write.test.ts`
Expected: PASS, 3 tests.

If the first case FAILS, a writer this plan did not account for exists —
report the offending path rather than adding it to an allowlist. If the third
case FAILS on an unexpected file, that file reads the enum early — remove the
read, not the assertion.

- [ ] **Step 3: Verify the test actually fails when the rule is broken**

A guard that cannot fail is worthless. Temporarily prove it bites:

```bash
mkdir -p "src/app/api/__guardcheck"
printf 'import { prisma } from "@/lib/prisma";\nexport async function POST() {\n  await prisma.campaign.update({ where: { id: "x" }, data: { status: "active" } });\n}\n' > "src/app/api/__guardcheck/route.ts"
npx vitest run src/__tests__/properties/campaign-status-dual-write.test.ts
```

Expected: FAIL, with `src/app/api/__guardcheck/route.ts` listed in the offenders array.

Then remove it and confirm green again:

```bash
rm -r "src/app/api/__guardcheck"
npx vitest run src/__tests__/properties/campaign-status-dual-write.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere. Record the final test and file counts
in the commit message.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: guard Campaign status dual-write against divergence

Every Campaign write sets lifecycleStatus next to the legacy string, and
this asserts it stays that way. The third case pins the ticket scope: only
the four writers plus the mapper mention the enum, so tickets 03-05 extend
the literal deliberately as they migrate readers."
```
