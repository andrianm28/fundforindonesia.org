# Campaign Lifecycle Migrate Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every server-side campaign lifecycle decision from the legacy string to the enum, with donation acceptance enforced once, centrally, on the enum.

**Architecture:** The only server-side lifecycle decision in the tree is the donations gate in `POST /api/donations` (payout, verification, and suspension paths make no string comparison today — Task 2 proves it by audit). A `campaignAcceptsDonations` helper joins `toLifecycleStatus` in `src/lib/campaign-lifecycle.ts`; the route selects `lifecycleStatus` and gates on the helper. The `status` string keeps being written everywhere, and catalogue/filter reads stay on the string for ticket 04.

**Tech Stack:** Next.js 14 App Router, Prisma, Postgres, Vitest.

**Spec:** `.scratch/prd-compliance-fase-0-2/spec.md` (ticket `.scratch/prd-compliance-fase-0-2/issues/03-lifecycle-migrate-server.md`)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    ~/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-20-lifecycle-migrate-server.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief
    ~/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-20-lifecycle-migrate-server.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- Only `ACTIVE` accepts a Donation, enforced in exactly one place: `campaignAcceptsDonations` in `src/lib/campaign-lifecycle.ts`, called by `POST /api/donations`.
- The gate keeps its `400` status and its exact message `Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.`
- `DONATIONS_ENABLED` stays `false` in production code; tests reach past it only by mocking `@/lib/donations` as an `importActual` spread with the flag overridden.
- The `status` string is still written by every writer (dual-write intact); CI stays green throughout.
- Catalogue and filter reads (`GET /api/zakat/campaigns`, explore, homepage, sitemap) and detail serialization (`GET /api/campaigns/[slug]` response body) stay on the string — ticket 04's work, explicitly not this ticket.
- Do not invent new gates: payout, verification, and suspension paths make no campaign-status string comparison today, so there is nothing to migrate there.
- All amounts are integer rupiah. Never introduce a float into a money path.
- The ledger is append-only: rows are added, never updated or deleted.
- Out of scope, do not build: ticket 04 UI migration; ticket 05 contract (dropping the string); Kind, Collecting Entity, permits, VerificationRequest; any change to the payment provider layer, escrow, payouts, refunds, or fees.

---

### Task 1: Central gate helper, wired into POST /api/donations

**Files:**
- Modify: `src/lib/campaign-lifecycle.ts` — append the `campaignAcceptsDonations` helper
- Modify: `src/app/api/donations/route.ts` — select `lifecycleStatus`, gate on the helper
- Create: `src/app/api/donations/route.enum-gate.test.ts` — enum-governance tests at the POST seam

**Interfaces:**
- Consumes: Task-nothing (first); ticket-02's `toLifecycleStatus` and `CampaignStatus` live in the same module already.
- Produces: `campaignAcceptsDonations(campaign: { lifecycleStatus: CampaignStatus }): boolean`, used by Task 2's edge matrix through the route (never imported by tests directly).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported POST handler of src/app/api/donations/route.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal (`campaignAcceptsDonations`) diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode. Satu pengecualian yang direstui: modul `@/lib/donations` di-mock sebagai spread `importActual` dengan hanya flag yang dioverride, supaya seam terjangkau selagi flag produksi tetap mati — perilaku yang diassert tetap respons HTTP dan pemanggilan provider, bukan isi modul.

- [ ] **Step 1: Write the failing divergence test**

Create `src/app/api/donations/route.enum-gate.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
    },
    donation: {
      create: vi.fn(),
    },
    prayer: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
    },
    webhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    notification: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments')>('@/lib/payments');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

// The route is gated shut in production (DONATIONS_ENABLED = false) and
// these tests must reach past that flag WITHOUT flipping it: mock the
// module as an importActual spread with only the flag overridden, so the
// real disabled message and every other export stay exactly as shipped.
vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return {
    ...actual,
    DONATIONS_ENABLED: true,
  };
});

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider } from '@/lib/payments';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;
const mockGetPaymentProvider = getPaymentProvider as unknown as Mock;

function donateRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/donations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_BODY = {
  campaignId: 'campaign-1',
  amount: 50000,
  paymentMethod: 'bank_transfer',
};

describe('POST /api/donations lifecycle gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Donor', email: 'donor@test.com' },
    });
    mockGetPaymentProvider.mockReturnValue({
      createCharge: vi.fn().mockResolvedValue({
        providerOrderId: 'order-1',
        method: 'bank_transfer_va',
        vaNumber: '8808123456789',
        expiresAt: new Date('2099-01-02T00:00:00.000Z'),
      }),
    });
  });

  it('the enum governs, not the string: active string with SUSPENDED enum is refused', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      lifecycleStatus: 'SUSPENDED',
      title: 'Bantu Korban Banjir',
      isDemo: false,
    });

    const response = await POST(donateRequest(VALID_BODY));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.'
    );
    expect(mockGetPaymentProvider).not.toHaveBeenCalled();
  });

  it('ACTIVE enum passes the gate and reaches the provider', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'active',
      lifecycleStatus: 'ACTIVE',
      title: 'Bantu Korban Banjir',
      isDemo: false,
    });

    await POST(donateRequest(VALID_BODY));

    expect(mockGetPaymentProvider).toHaveBeenCalled();
  });
});
```

If the route's later stages need further mocks to run without throwing
before reaching the provider (mirror `src/app/api/donations/route.test.ts`
and `src/__tests__/integration/donation-flow.test.ts` as needed), add only
mock setups, never change the two asserted payloads above.

Run: `npx vitest run src/app/api/donations/route.enum-gate.test.ts`
Expected: FAIL — the diverged-columns case passes the string gate and
reaches the provider (or throws later), so the 400 assertion fails. The
ACTIVE case already passes. That split is the RED.

- [ ] **Step 2: Add the helper**

Append to `src/lib/campaign-lifecycle.ts`:

```typescript
/**
 * Single enforcement point for "only ACTIVE accepts a Donation".
 * POST /api/donations is the only caller. The argument is the whole
 * campaign row as selected, so the gate reads the enum that writers
 * maintain, never the legacy string.
 */
export function campaignAcceptsDonations(campaign: {
  lifecycleStatus: CampaignStatus;
}): boolean {
  return campaign.lifecycleStatus === CampaignStatus.ACTIVE;
}
```

- [ ] **Step 3: Wire the route**

In `src/app/api/donations/route.ts`, add the import next to the other
`@/lib` imports:

```typescript
import { campaignAcceptsDonations } from "@/lib/campaign-lifecycle";
```

Extend the campaign select:

```typescript
      select: { id: true, status: true, title: true, isDemo: true },
```

to:

```typescript
      select: {
        id: true,
        status: true,
        lifecycleStatus: true,
        title: true,
        isDemo: true,
      },
```

and change the gate from:

```typescript
    if (campaign.status !== 'active') {
```

to:

```typescript
    if (!campaignAcceptsDonations(campaign)) {
```

Keep the 400 status and the exact Indonesian message byte-identical. Touch
nothing else in the file.

- [ ] **Step 4: Run the tests, typecheck, and full suite**

Run: `npx vitest run src/app/api/donations/route.enum-gate.test.ts`
Expected: PASS, 2 tests.

Run:

```bash
npx tsc --noEmit 2>&1 | grep -i "lifecycle\|donations/route" || echo "no type errors in the gate"
```

Expected: `no type errors in the gate` (pre-existing backlog elsewhere is
not this task's).

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere. The existing
`src/app/api/donations/route.test.ts` still passes unchanged: it never gets
past the real `DONATIONS_ENABLED = false`, which this ticket does not flip.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: enforce donation acceptance on the lifecycle enum

POST /api/donations gates on campaignAcceptsDonations, the single
enforcement point for only-ACTIVE-accepts-donations. The 400 and its
message are unchanged; the flag stays shut; the string keeps being
written."
```

### Task 2: Edge matrix and the no-other-decisions audit

**Files:**
- Modify: `src/app/api/donations/route.enum-gate.test.ts` — append the full status matrix

**Interfaces:**
- Consumes: Task 1's helper and wiring.
- Produces: proof that every non-ACTIVE value refuses and the enum (not the
  string) decides in both divergence directions. Task 3 relies on the gate
  holding while it updates the guard literal.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported POST handler of src/app/api/donations/route.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal (`campaignAcceptsDonations`) diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode. Audit grep Step 2 adalah pembuktian cakupan, bukan test — temuannya yang berupa keputusan enforcement dimigrasi lewat seam yang sama.

- [ ] **Step 1: Append the matrix**

In `src/app/api/donations/route.enum-gate.test.ts`, inside the existing
top-level `describe` block (reusing its `beforeEach`, request helper, and
mocks), append:

```typescript
describe.each([
  ['SUBMITTED', 'pending'],
  ['REJECTED', 'rejected'],
  ['SUSPENDED', 'suspended'],
  ['CANCELLED', 'active'],
  ['COMPLETED', 'completed'],
  ['EXPIRED', 'expired'],
  ['DRAFT', 'pending'],
] as const)('lifecycleStatus %s refuses donations', (lifecycleStatus, status) => {
  it('returns 400 with the unchanged message and never reaches the provider', async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      status,
      lifecycleStatus,
      title: 'Bantu Korban Banjir',
      isDemo: false,
    });

    const response = await POST(donateRequest(VALID_BODY));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe(
      'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.'
    );
    expect(mockGetPaymentProvider).not.toHaveBeenCalled();
  });
});

it('the enum governs in reverse: suspended string with ACTIVE enum passes the gate', async () => {
  mockCampaignFindUnique.mockResolvedValue({
    id: 'campaign-1',
    status: 'suspended',
    lifecycleStatus: 'ACTIVE',
    title: 'Bantu Korban Banjir',
    isDemo: false,
  });

  await POST(donateRequest(VALID_BODY));

  expect(mockGetPaymentProvider).toHaveBeenCalled();
});
```

Note the two deliberately diverged rows: `CANCELLED` has no legacy source
so it rides `active`, and the reverse case proves the string is dead. Real
rows cannot diverge (dual-write + backfill), but the gate must not trust
the string even if they ever do.

Run: `npx vitest run src/app/api/donations/route.enum-gate.test.ts`
Expected: PASS, 10 tests (2 from Task 1 plus 7 matrix rows plus 1 reverse
case).

- [ ] **Step 2: Audit for other server-side string decisions**

Run:

```bash
grep -rn "campaign\.status\|status: *['\"]active['\"]\|status !== *['\"]" src/app/api src/lib --include=*.ts --include=*.tsx | grep -v generated | grep -v ".test." | grep -v "paymentStatus\|PaymentStatus\|payout\.status\|event\.status\|status === 'authenticated'"
```

Read every hit and classify it in your report:
- A decision about whether a campaign may be donated to, paid out,
  verified, or suspended made from the string: migrate it in THIS task to
  the enum with a matching seam test (same pattern as Task 1), and name it
  in the commit message.
- Display, filter, or serialization (e.g. the zakat catalogue filter,
  detail response bodies), or a dual-write line: leave it — ticket 04 owns
  display, ticket 02 owns the writes — and record each left hit with its
  one-line reason in your report.

Expected finding: only `GET /api/zakat/campaigns` (catalogue filter, ticket
04) plus serialization/writes remain. If the audit surfaces a genuine
enforcement decision, migrating it here is in scope; silently leaving one
is not.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere. Record the final test and file counts
for the commit message.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: cover every lifecycle value at the donations gate

All seven non-ACTIVE values refuse with the unchanged 400, and both
divergence directions prove the enum decides. Audit: no other
server-side campaign-status decision exists to migrate."
```

If Step 2 migrates an extra decision, extend the message's last line to
name it (e.g. `Audit: the <route> check now reads the enum too.`).

### Task 3: Extend the dual-write guard to the first enum reader

**Files:**
- Modify: `src/__tests__/properties/campaign-status-dual-write.test.ts` — add the donations route to the readers literal

**Interfaces:**
- Consumes: Tasks 1 and 2 — the route mentions `lifecycleStatus`, or the
  guard fails by design.
- Produces: the standing guard knows the first reader. Tickets 04-05 extend
  the literal further as they migrate display and contract.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the campaign-status-dual-write guard test run against the source tree`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu. Literal pembaca adalah literal yang diketahui, bukan sesuatu yang dihitung ulang oleh test; mengikuti preseden guard ticket 02 yang diperluas pembaca pertamanya di sini.

- [ ] **Step 1: Extend the readers literal**

In `src/__tests__/properties/campaign-status-dual-write.test.ts`, in the
third case (`no reader has moved to the enum yet`), rename it to reflect
the new truth and add the route:

```typescript
  it("only the donations gate has moved to the enum so far", () => {
```

and add `"src/app/api/donations/route.ts"` to its sorted literal, keeping
the existing five entries byte-identical. Update that case's preceding
comment (the one explaining the pin) with one appended sentence:
`Ticket 03 moved POST /api/donations, the first reader; tickets 04-05
extend this literal further.`

- [ ] **Step 2: Run the guard and the full suite**

Run: `npx vitest run src/__tests__/properties/campaign-status-dual-write.test.ts`
Expected: PASS, 3 tests.

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere. Record the final test and file counts
in the commit message.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: pin the first enum reader in the dual-write guard

POST /api/donations joins the literal; tickets 04-05 extend it further as
they migrate display and contract."
```
