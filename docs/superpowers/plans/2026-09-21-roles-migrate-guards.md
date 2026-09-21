# Roles Migrate Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every route and page that currently gates on the Role hierarchy for an Admin or Verifier decision gates on the specific Assignment (ADR 0005) instead, so an Admin is no longer a Verifier by accident.

**Architecture:** A new `withAssignmentCheck` mirrors the existing `withRoleCheck` exactly in shape (401/403/500 semantics) but checks `session.user.assignments.includes(requiredAssignment)` instead of rank. `session.user.assignments` is populated the same way `session.user.role` already is: `src/lib/auth.ts`'s `jwt()` callback already re-queries the user unconditionally on every `getServerSession()` call to refresh `role`/`isVerified`/`verificationType` into the token; this plan extends that same query to also select `UserAssignment` rows, so no new DB-call site is introduced. Of the 11 files the existing scope guard (`roles-expand-guard.test.ts`) tracks, only 7 gate an Admin/Verifier decision (`withRoleCheck('ADMIN', ...)` or `withRoleCheck('MODERATOR', ...)` / `isAtLeast(role, 'MODERATOR')`); the other 4 gate on `CAMPAIGN_CREATOR` or `DONOR`, which check account type, not the Verifier/Admin split, and have no Assignment equivalent — they are not touched. The Role hierarchy itself (`isAtLeast`, `ROLE_LEVELS`, the `Role` enum) is not removed; only the 7 files stop deciding access by it. Removing the hierarchy is ticket 08.

**Tech Stack:** Next.js 14 App Router, NextAuth v4 (JWT strategy), Prisma, Postgres, Vitest.

**Spec:** `.scratch/prd-compliance-fase-0-2/spec.md` (ticket `.scratch/prd-compliance-fase-0-2/issues/07-roles-migrate-guards.md`)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    ~/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-21-roles-migrate-guards.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief
    ~/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-21-roles-migrate-guards.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- Exactly these 7 files gate an Admin/Verifier decision and are the only ones migrated: `src/app/api/admin/reconcile/route.ts`, `src/app/api/admin/users/[id]/role/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/campaigns/[slug]/payouts/[id]/approve/route.ts` (all four require Assignment.ADMIN), and `src/app/api/moderasi/campaigns/[id]/route.ts`, `src/app/moderasi/layout.tsx`, `src/app/moderasi/page.tsx` (all three require Assignment.VERIFIER).
- Do NOT touch `src/app/api/campaigns/[slug]/payouts/route.ts`, `src/app/api/campaigns/route.ts`, `src/app/api/campaigns/[slug]/route.ts`, or `src/app/api/upload/route.ts`. These gate on `CAMPAIGN_CREATOR` or `DONOR` — account type, not the Verifier/Admin split — and there is no Assignment equivalent for either. Migrating them would be wrong, not merely out of scope.
- Do NOT touch `src/app/admin/layout.tsx`. It gates on `session.user.role !== "ADMIN"` directly and is a real Admin concern, but it was never part of the scope `roles-expand-guard.test.ts` established in ticket 06, and expanding scope here is not this ticket's call to make.
- Do NOT remove `isAtLeast`, `ROLE_LEVELS`, `hasRole`, `requireRole`, `withRoleCheck`, or the `Role` enum. They keep governing the 4 untouched routes above. Removing them is ticket 08 (roles-contract).
- Do NOT add a capacity/assignment column to `Payout`, `Notification`, or any other model. ADR 0005's stated problem — the audit trail cannot show which capacity a multi-assignment person acted in — is resolved structurally: once a route requires one specific assignment rather than a minimum rank, the assignment used is unambiguous from which route accepted the request. No new schema field records this; the migration itself is what removes the ambiguity.
- `session.user.assignments` is always an array, never `undefined`, defaulting to `[]` for a user with no `UserAssignment` rows — matching how `role` already defaults to `"DONOR"` when missing.
- All amounts are integer rupiah. Never introduce a float into a money path.
- The ledger is append-only: rows are added, never updated or deleted.
- Out of scope, do not build: ticket 08 (dropping the Role hierarchy entirely); Verification Request as an entity (ticket 12) — the closest proof available today that "an Admin without the Verifier assignment can no longer approve" is the moderation route and the 4 Admin routes, not a Verification Request that does not exist yet; any change to the payment provider layer, escrow, payouts, refunds, or fees beyond the guard swap on the one payout-approval route named above.

---

### Task 1: Carry assignments onto the session

**Files:**
- Modify: `src/lib/auth.ts` — `jwt()` callback's existing `prisma.user.findUnique` select, and `session()` callback
- Modify: `src/types/next-auth.d.ts` — add `assignments` to `Session.user` and `JWT`
- Create: `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces: `session.user.assignments: Assignment[]` (from `@/generated/prisma/client`), always present, defaulting to `[]`. Task 2's `withAssignmentCheck` and Task 4's page guards both read this field.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported authOptions.callbacks.jwt and authOptions.callbacks.session functions`. `getServerSession` itself is a thin wrapper around NextAuth's own session decoding, which is not exercised by any test in this repo (no `auth.test.ts` exists today, and every other test mocks `@/lib/auth` at the module boundary rather than running it) — `authOptions` is exported specifically so `nextAuthGetServerSession(authOptions)` and `PrismaAdapter(prisma)` can consume it, and that same export is the correct, direct seam for this task. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi-fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

const mockFindUnique = prisma.user.findUnique as unknown as Mock;

describe("authOptions.callbacks.jwt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carries the user's current assignments onto the token", async () => {
    mockFindUnique.mockResolvedValue({
      isVerified: true,
      verificationType: "organization",
      role: "ADMIN",
      assignments: [{ assignment: "VERIFIER" }, { assignment: "ADMIN" }],
    });

    const token = await authOptions.callbacks!.jwt!({
      token: { id: "user-1" } as any,
      user: undefined as any,
      account: null,
      profile: undefined,
      trigger: undefined,
    } as any);

    expect(token.assignments).toEqual(["VERIFIER", "ADMIN"]);
  });

  it("gives a user with no assignment rows an empty array, not undefined", async () => {
    mockFindUnique.mockResolvedValue({
      isVerified: false,
      verificationType: null,
      role: "DONOR",
      assignments: [],
    });

    const token = await authOptions.callbacks!.jwt!({
      token: { id: "user-2" } as any,
      user: undefined as any,
      account: null,
      profile: undefined,
      trigger: undefined,
    } as any);

    expect(token.assignments).toEqual([]);
  });

  it("selects assignments in the same query as role, not a second DB call", async () => {
    mockFindUnique.mockResolvedValue({
      isVerified: true,
      verificationType: null,
      role: "MODERATOR",
      assignments: [{ assignment: "VERIFIER" }],
    });

    await authOptions.callbacks!.jwt!({
      token: { id: "user-3" } as any,
      user: undefined as any,
      account: null,
      profile: undefined,
      trigger: undefined,
    } as any);

    expect(mockFindUnique).toHaveBeenCalledOnce();
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "user-3" },
      select: {
        isVerified: true,
        verificationType: true,
        role: true,
        assignments: { select: { assignment: true } },
      },
    });
  });
});

describe("authOptions.callbacks.session", () => {
  it("copies the token's assignments onto session.user.assignments", async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" } as any,
      token: { id: "user-1", role: "ADMIN", assignments: ["ADMIN", "VERIFIER"] } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(session.user.assignments).toEqual(["ADMIN", "VERIFIER"]);
  });

  it("defaults assignments to an empty array when the token has none", async () => {
    const session = await authOptions.callbacks!.session!({
      session: { user: {}, expires: "2099-01-01" } as any,
      token: { id: "user-2", role: "DONOR" } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(session.user.assignments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL. The `jwt` tests fail because `token.assignments` is `undefined` (the current select does not fetch it); the `session` tests fail for the same reason.

- [ ] **Step 3: Modify `src/lib/auth.ts`**

Change the import line from:

```typescript
import { Role } from "@/generated/prisma/client";
```

to:

```typescript
import { Role, Assignment } from "@/generated/prisma/client";
```

Replace the `jwt` callback:

```typescript
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }

      // Fetch latest verification status from DB
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { isVerified: true, verificationType: true, role: true },
        });

        if (dbUser) {
          token.isVerified = dbUser.isVerified;
          token.verificationType = dbUser.verificationType;
          token.role = dbUser.role;
        }
      }

      return token;
    },
```

with:

```typescript
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }

      // Fetch latest verification status from DB
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: {
            isVerified: true,
            verificationType: true,
            role: true,
            assignments: { select: { assignment: true } },
          },
        });

        if (dbUser) {
          token.isVerified = dbUser.isVerified;
          token.verificationType = dbUser.verificationType;
          token.role = dbUser.role;
          token.assignments = dbUser.assignments.map((a) => a.assignment);
        }
      }

      return token;
    },
```

Replace the `session` callback:

```typescript
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as Role) ?? "DONOR";
        session.user.isVerified = token.isVerified as boolean;
        session.user.verificationType = token.verificationType as string | null;
      }
      return session;
    },
```

with:

```typescript
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as Role) ?? "DONOR";
        session.user.isVerified = token.isVerified as boolean;
        session.user.verificationType = token.verificationType as string | null;
        session.user.assignments = (token.assignments as Assignment[]) ?? [];
      }
      return session;
    },
```

- [ ] **Step 4: Modify `src/types/next-auth.d.ts`**

Replace the entire file with:

```typescript
import { Role, Assignment } from "@/generated/prisma/client";
import { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      isVerified: boolean;
      verificationType: string | null;
      assignments: Assignment[];
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role?: Role;
    isVerified?: boolean;
    verificationType?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    role?: Role;
    isVerified?: boolean;
    verificationType?: string | null;
    assignments?: Assignment[];
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "auth\.ts|next-auth\.d\.ts"`
Expected: no output (no type errors naming either file). The repo has a pre-existing backlog of unrelated type errors; only errors naming these two files matter here.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS, no FAIL anywhere. Adding a field to `Session`/`JWT` is additive and must not change any other test's behavior.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: carry UserAssignment rows onto the session

session.user.assignments is populated the same way session.user.role already
is: the jwt() callback's existing per-request DB refresh now also selects
assignments, so no new DB call site is introduced. Defaults to [] for a user
with no UserAssignment rows.

Nothing reads this field yet -- withAssignmentCheck (next) is its first
consumer."
```

### Task 2: The withAssignmentCheck primitive

**Files:**
- Create: `src/lib/withAssignmentCheck.ts`
- Create: `src/lib/withAssignmentCheck.test.ts`

**Interfaces:**
- Consumes: `session.user.assignments: Assignment[]` from Task 1.
- Produces: `hasAssignment(assignments: Assignment[] | undefined, required: Assignment): boolean` and `withAssignmentCheck(requiredAssignment: Assignment, handler: (req: NextRequest, context?: any) => Promise<NextResponse>): (req: NextRequest, context?: any) => Promise<NextResponse>`. Task 3 and Task 4 import both from `@/lib/withAssignmentCheck`.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported withAssignmentCheck wrapper, invoked as a route handler`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. `hasAssignment`, meskipun diekspor untuk dipakai Task 4's page guards, diuji di sini secara tidak langsung lewat `withAssignmentCheck`, tidak pernah dengan memanggilnya langsung. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing test**

Create `src/lib/withAssignmentCheck.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "@/lib/auth";
import { withAssignmentCheck } from "./withAssignmentCheck";

const mockGetServerSession = vi.mocked(getServerSession);

function createMockRequest(url = "http://localhost:3000/api/test") {
  return new NextRequest(url);
}

describe("withAssignmentCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 when session has no user", async () => {
    mockGetServerSession.mockResolvedValue({ user: null } as any);

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the required assignment is missing", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", assignments: ["VERIFIER"] },
    } as any);

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when assignments is missing entirely, even for an ADMIN-ranked user", async () => {
    // The exact scenario ADR 0005 exists to fix: rank alone must never
    // substitute for the assignment a route requires.
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "ADMIN" },
    } as any);

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler when the required assignment is present", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", assignments: ["ADMIN"] },
    } as any);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(handler).toHaveBeenCalledOnce();
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  it("passes a user holding both assignments through either gate", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", assignments: ["VERIFIER", "ADMIN"] },
    } as any);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));

    const adminWrapped = withAssignmentCheck("ADMIN", handler);
    expect((await adminWrapped(createMockRequest())).status).toBe(200);

    const verifierWrapped = withAssignmentCheck("VERIFIER", handler);
    expect((await verifierWrapped(createMockRequest())).status).toBe(200);
  });

  it("returns 500 and does not leak 403 when the handler throws", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", assignments: ["ADMIN"] },
    } as any);

    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(500);
  });

  it("returns 500 when getServerSession itself throws", async () => {
    mockGetServerSession.mockRejectedValue(new Error("session lookup failed"));

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/withAssignmentCheck.test.ts`
Expected: FAIL with a module-not-found error for `./withAssignmentCheck`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/withAssignmentCheck.ts` with exactly this content:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { Assignment } from "@/generated/prisma/client";

type RouteHandler = (
  req: NextRequest,
  context?: any
) => Promise<NextResponse>;

/**
 * True if the given assignments include the required one. Treats a
 * missing list as no assignments -- deny by default, never assume.
 */
export function hasAssignment(
  assignments: Assignment[] | undefined,
  required: Assignment
): boolean {
  return (assignments ?? []).includes(required);
}

/**
 * Higher-order function that wraps a Next.js API route handler with
 * assignment-based authorization (ADR 0005): Verifier and Admin are
 * independent assignments, not ranks, so this checks for the ONE specific
 * assignment a route requires rather than a minimum rank. A person who
 * holds both assignments passes both checks; a person who holds only one
 * cannot use the other's routes by virtue of outranking it, which is
 * exactly what the Role hierarchy used to allow.
 *
 * - Returns 401 if no session (unauthenticated)
 * - Returns 403 if the required assignment is missing
 * - Returns 500 on unexpected errors (never leaks 403 on system errors)
 * - Passes through to the handler if authorized
 */
export function withAssignmentCheck(
  requiredAssignment: Assignment,
  handler: RouteHandler
): RouteHandler {
  return async (req: NextRequest, context?: any) => {
    try {
      const session = await getServerSession();

      if (!session?.user) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }

      if (!hasAssignment(session.user.assignments, requiredAssignment)) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        );
      }

      return await handler(req, context);
    } catch (error) {
      return NextResponse.json(
        { error: "Internal Server Error" },
        { status: 500 }
      );
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/withAssignmentCheck.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS, no FAIL anywhere.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add withAssignmentCheck, the assignment-based route guard

Mirrors withRoleCheck exactly in shape (401/403/500) but checks for one
specific Assignment rather than a minimum Role rank. Nothing calls it yet."
```

### Task 3: Migrate the four Admin-gated API routes

**Files:**
- Modify: `src/app/api/admin/reconcile/route.ts`
- Modify: `src/app/api/admin/reconcile/route.test.ts`
- Modify: `src/app/api/admin/users/[id]/role/route.ts`
- Create: `src/app/api/admin/users/[id]/role/route.test.ts`
- Modify: `src/app/api/admin/users/route.ts`
- Create: `src/app/api/admin/users/route.test.ts`
- Modify: `src/app/api/campaigns/[slug]/payouts/[id]/approve/route.ts`
- Modify: `src/app/api/campaigns/[slug]/payouts/[id]/approve/route.test.ts`

**Interfaces:**
- Consumes: `withAssignmentCheck`, `hasAssignment` from Task 2.
- Produces: nothing new for later tasks; Task 5's guard reads these files' source text.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported route handler of each of the four files`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Migrate `src/app/api/admin/reconcile/route.ts`**

Change:

```typescript
import { withRoleCheck } from '@/lib/withRoleCheck';
```

to:

```typescript
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
```

Change:

```typescript
export const GET = withRoleCheck('ADMIN', async (_req: NextRequest) => {
```

to:

```typescript
export const GET = withAssignmentCheck(Assignment.ADMIN, async (_req: NextRequest) => {
```

- [ ] **Step 2: Update `src/app/api/admin/reconcile/route.test.ts`**

Change the `beforeEach` default session from:

```typescript
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
```

to:

```typescript
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
```

Replace the test:

```typescript
  it('returns 403 for a MODERATOR, which sits below ADMIN', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR' } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
```

with:

```typescript
  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment', async () => {
    // The exact scenario ADR 0005 exists to fix: rank alone must never
    // substitute for the assignment this route requires.
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-1', role: 'ADMIN', assignments: [] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run this file's tests to verify they pass**

Run: `npx vitest run src/app/api/admin/reconcile/route.test.ts`
Expected: PASS, one more test than before.

- [ ] **Step 4: Migrate `src/app/api/admin/users/[id]/role/route.ts`**

Change:

```typescript
import { withRoleCheck } from "@/lib/withRoleCheck";
```

to:

```typescript
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
```

Change the import line for `Role` from:

```typescript
import { Role } from "@/generated/prisma/client";
```

to:

```typescript
import { Role, Assignment } from "@/generated/prisma/client";
```

Change:

```typescript
export const PATCH = withRoleCheck("ADMIN", async (req: NextRequest, context: any) => {
```

to:

```typescript
export const PATCH = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
```

- [ ] **Step 5: Write the failing test for `src/app/api/admin/users/[id]/role/route.ts`**

Create `src/app/api/admin/users/[id]/role/route.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockUserUpdate = prisma.user.update as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/users/user-2/role", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function routeContext(id = "user-2") {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/admin/users/[id]/role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN"] } });
    mockUserUpdate.mockResolvedValue({ id: "user-2", name: "Someone", email: "someone@test.com", role: "MODERATOR" });
    mockNotificationCreate.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext());
    expect(response.status).toBe(401);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for a Verifier who does not hold the Admin assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", role: "ADMIN", assignments: [] } });
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("updates the role and notifies the affected user when the Admin assignment is present", async () => {
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { role: "MODERATOR" },
      select: { id: true, name: true, email: true, role: true },
    });
    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("rejects an invalid role with 400 before touching the database", async () => {
    const response = await PATCH(createRequest({ role: "NOT_A_ROLE" }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("refuses to remove ADMIN from yourself", async () => {
    const response = await PATCH(createRequest({ role: "MODERATOR" }), routeContext("admin-1"));
    expect(response.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run "src/app/api/admin/users/[id]/role/route.test.ts"`
Expected: PASS, 6 tests.

- [ ] **Step 7: Migrate `src/app/api/admin/users/route.ts`**

Change:

```typescript
import { withRoleCheck } from "@/lib/withRoleCheck";
```

to:

```typescript
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
```

Change:

```typescript
export const GET = withRoleCheck("ADMIN", async (req: NextRequest) => {
```

to:

```typescript
export const GET = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
```

- [ ] **Step 8: Write the failing test for `src/app/api/admin/users/route.ts`**

Create `src/app/api/admin/users/route.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockFindMany = prisma.user.findMany as unknown as Mock;
const mockCount = prisma.user.count as unknown as Mock;

function createRequest(url = "http://localhost:3000/api/admin/users"): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN"] } });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 403 for a Verifier who does not hold the Admin assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", role: "ADMIN", assignments: [] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns the user page when the Admin assignment is present", async () => {
    mockFindMany.mockResolvedValue([{ id: "u1", name: "A", email: "a@test.com", role: "DONOR", isVerified: false, createdAt: new Date() }]);
    mockCount.mockResolvedValue(1);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
  });
});
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run src/app/api/admin/users/route.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 10: Migrate `src/app/api/campaigns/[slug]/payouts/[id]/approve/route.ts`**

Change:

```typescript
import { withRoleCheck } from '@/lib/withRoleCheck';
```

to:

```typescript
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
```

Change the doc comment (note the comment text itself names `withRoleCheck`, which must change too, or a later text-based guard would still see the old name):

```typescript
/**
 * POST /api/campaigns/[slug]/payouts/[id]/approve -- ADMIN approves a DRAFT
 * payout and releases it in the same action.
 *
 * withRoleCheck('ADMIN') gates on role only and does not pass the session to
 * the handler, so getServerSession is called again here to learn who is
 * approving -- that identity is what the two-person check in
 * approvePayout compares against requestedById.
 */
export const POST = withRoleCheck('ADMIN', async (_request: NextRequest, context: any) => {
```

to:

```typescript
/**
 * POST /api/campaigns/[slug]/payouts/[id]/approve -- an Admin approves a
 * DRAFT payout and releases it in the same action.
 *
 * withAssignmentCheck(Assignment.ADMIN) gates on the assignment only and
 * does not pass the session to the handler, so getServerSession is called
 * again here to learn who is approving -- that identity is what the
 * two-person check in approvePayout compares against requestedById.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (_request: NextRequest, context: any) => {
```

- [ ] **Step 11: Update `src/app/api/campaigns/[slug]/payouts/[id]/approve/route.test.ts`**

Change the `beforeEach` default session from:

```typescript
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
```

to:

```typescript
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
```

Replace the test:

```typescript
  it('returns 403 for MODERATOR, which sits below ADMIN', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR' } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
```

with:

```typescript
  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-1', role: 'ADMIN', assignments: [] } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
```

In the test `'refuses self-approval with 403 and leaves the payout completely untouched'`, change:

```typescript
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', role: 'ADMIN' } });
```

to:

```typescript
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', role: 'ADMIN', assignments: ['ADMIN'] } });
```

This one is easy to miss: it overrides the `beforeEach` default with a scenario-specific session, and without `assignments` it would now be refused at the gate before the self-approval logic it is meant to exercise ever runs.

- [ ] **Step 12: Run this file's tests to verify they pass**

Run: `npx vitest run "src/app/api/campaigns/[slug]/payouts/[id]/approve/route.test.ts"`
Expected: PASS, one more test than before.

- [ ] **Step 13: Typecheck and run the full suite**

Run: `npx tsc --noEmit 2>&1 | grep -iE "admin/reconcile|admin/users|payouts/\[id\]/approve"`
Expected: no output.

Run: `npx vitest run`
Expected: PASS, no FAIL anywhere. Record the final test and file counts in the commit message.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: migrate the four Admin-gated API routes to withAssignmentCheck

api/admin/reconcile, api/admin/users, api/admin/users/[id]/role, and
api/campaigns/[slug]/payouts/[id]/approve now require Assignment.ADMIN
instead of a minimum Role rank. Every existing test's session mock override
gained assignments; two are new regression tests proving an ADMIN-ranked
user without the ADMIN assignment is refused -- the exact case ADR 0005
exists to fix."
```

### Task 4: Migrate the moderation route and the two Verifier pages

**Files:**
- Modify: `src/app/api/moderasi/campaigns/[id]/route.ts`
- Modify: `src/app/api/moderasi/campaigns/[id]/route.test.ts`
- Create: `src/app/api/moderasi/campaigns/[id]/route.assignment-gate.test.ts`
- Modify: `src/app/moderasi/layout.tsx`
- Create: `src/app/moderasi/layout.test.tsx`
- Modify: `src/app/moderasi/page.tsx`
- Create: `src/app/moderasi/page.test.tsx`

**Interfaces:**
- Consumes: `withAssignmentCheck`, `hasAssignment` from Task 2.
- Produces: nothing new for later tasks; Task 5's guard reads these files' source text.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported route handler for the API route, and the exported async page/layout component for the two pages`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

`src/app/api/moderasi/campaigns/[id]/route.test.ts` already mocks `@/lib/withRoleCheck` as a bare passthrough (`(_role, handler) => handler`) so it can test the PATCH handler's business logic without touching authorization at all. That scope is preserved here: the mock is retargeted to the new module, not removed, and a real gate is proven instead by the new sibling `route.assignment-gate.test.ts` file, which does NOT mock `@/lib/withAssignmentCheck` and exercises the real gate. This mirrors an existing precedent in this repo (`route.enum-gate.test.ts` alongside `route.ts` for the same kind of need).

- [ ] **Step 1: Migrate `src/app/api/moderasi/campaigns/[id]/route.ts`**

Change:

```typescript
import { withRoleCheck } from "@/lib/withRoleCheck";
```

to:

```typescript
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
```

Change:

```typescript
export const PATCH = withRoleCheck("MODERATOR", async (req: NextRequest, context: any) => {
```

to:

```typescript
export const PATCH = withAssignmentCheck(Assignment.VERIFIER, async (req: NextRequest, context: any) => {
```

- [ ] **Step 2: Retarget the existing test's passthrough mock**

In `src/app/api/moderasi/campaigns/[id]/route.test.ts`, change:

```typescript
  withRoleCheck: (_role: string, handler: unknown) => handler,
```

to:

```typescript
  withAssignmentCheck: (_assignment: string, handler: unknown) => handler,
```

and update the `vi.mock` call's target module path from `"@/lib/withRoleCheck"` to `"@/lib/withAssignmentCheck"` if the module path is given separately from the factory (check the surrounding `vi.mock(...)` line in this file and update the string literal to match).

- [ ] **Step 3: Run this file's tests to verify they still pass**

Run: `npx vitest run "src/app/api/moderasi/campaigns/[id]/route.test.ts"`
Expected: PASS, same test count as before. This file's job is business logic, not authorization, and its scope has not changed.

- [ ] **Step 4: Write the failing test proving the real gate**

Create `src/app/api/moderasi/campaigns/[id]/route.assignment-gate.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
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

vi.mock("@/lib/campaign-lifecycle", () => ({
  toLifecycleStatus: vi.fn(() => "ACTIVE"),
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockCampaignUpdate = prisma.campaign.update as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;

function createRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/moderasi/campaigns/campaign-1", {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
    headers: { "Content-Type": "application/json" },
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: "campaign-1" }) };
}

describe("PATCH /api/moderasi/campaigns/[id] -- the real assignment gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCampaignFindUnique.mockResolvedValue({ id: "campaign-1", creatorId: "creator-1", title: "Test" });
    mockCampaignUpdate.mockResolvedValue({ id: "campaign-1" });
    mockNotificationCreate.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockCampaignUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the Verifier assignment", async () => {
    // The exact scenario ADR 0005 exists to fix: rank alone must never
    // substitute for the assignment this route requires.
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: [] } });
    const response = await PATCH(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockCampaignUpdate).not.toHaveBeenCalled();
  });

  it("passes a MODERATOR-ranked user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const response = await PATCH(createRequest(), routeContext());
    expect(response.status).toBe(200);
    expect(mockCampaignUpdate).toHaveBeenCalledOnce();
  });

  it("passes an ADMIN-ranked user who also holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN", "VERIFIER"] } });
    const response = await PATCH(createRequest(), routeContext());
    expect(response.status).toBe(200);
    expect(mockCampaignUpdate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `npx vitest run "src/app/api/moderasi/campaigns/[id]/route.assignment-gate.test.ts"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Migrate `src/app/moderasi/layout.tsx`**

Change:

```typescript
import { isAtLeast } from "@/lib/roles";
```

to:

```typescript
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
```

Change:

```typescript
  if (!session?.user || !isAtLeast(session.user.role, "MODERATOR")) {
    redirect("/");
  }
```

to:

```typescript
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }
```

- [ ] **Step 7: Write the failing test for `src/app/moderasi/layout.tsx`**

Create `src/app/moderasi/layout.test.tsx` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { getServerSession } from "@/lib/auth";
import ModerasiLayout from "./layout";

const mockGetServerSession = getServerSession as unknown as Mock;

describe("ModerasiLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(ModerasiLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("redirects home for an ADMIN-ranked user who does not hold the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: [] } });
    await expect(ModerasiLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("renders for a user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const result = await ModerasiLayout({ children: null });
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/app/moderasi/layout.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 9: Migrate `src/app/moderasi/page.tsx`**

Change:

```typescript
import { isAtLeast } from "@/lib/roles";
```

to:

```typescript
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
```

Change:

```typescript
  if (!session?.user || !isAtLeast(session.user.role, "MODERATOR")) {
    redirect("/");
  }
```

to:

```typescript
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }
```

- [ ] **Step 10: Write the failing test for `src/app/moderasi/page.tsx`**

Create `src/app/moderasi/page.test.tsx` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      count: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ModerasiPage from "./page";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockCampaignCount = prisma.campaign.count as unknown as Mock;

describe("ModerasiPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCampaignCount.mockResolvedValue(0);
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(ModerasiPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockCampaignCount).not.toHaveBeenCalled();
  });

  it("redirects home for an ADMIN-ranked user who does not hold the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: [] } });
    await expect(ModerasiPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockCampaignCount).not.toHaveBeenCalled();
  });

  it("renders for a user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const result = await ModerasiPage();
    expect(result).toBeDefined();
    expect(mockCampaignCount).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `npx vitest run src/app/moderasi/page.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 12: Typecheck and run the full suite**

Run: `npx tsc --noEmit 2>&1 | grep -iE "moderasi"`
Expected: no output.

Run: `npx vitest run`
Expected: PASS, no FAIL anywhere.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: migrate moderation to withAssignmentCheck / hasAssignment

api/moderasi/campaigns/[id], moderasi/layout.tsx, and moderasi/page.tsx now
require Assignment.VERIFIER instead of a minimum MODERATOR rank.

The existing route.test.ts keeps testing business logic only (its
withRoleCheck passthrough mock is retargeted, not removed); a new sibling
route.assignment-gate.test.ts proves the real gate, mirroring the
enum-gate.test.ts precedent this repo already uses for the same need."
```

### Task 5: Pin the new scope in the guard

**Files:**
- Modify: `src/__tests__/properties/roles-expand-guard.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4 — every migrated file must already say `Assignment.ADMIN` or `Assignment.VERIFIER`, or this guard fails by design.
- Produces: the standing guard for tickets 08+ to extend further.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the roles-expand-guard test run against the source tree`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu. Literal pembaca adalah literal yang diketahui, bukan sesuatu yang dihitung ulang oleh test.

- [ ] **Step 1: Write the failing changes to the guard**

Replace the entire content of `src/__tests__/properties/roles-expand-guard.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Ticket 06 only recorded assignments; ticket 07 makes seven of them
 * decide access. This test pins the boundary three ways: the four files
 * that still legitimately gate on account type (CAMPAIGN_CREATOR/DONOR,
 * which have no Assignment equivalent) still enforce the Role hierarchy;
 * the seven Admin/Verifier files no longer decide access by hierarchy at
 * all; and exactly those seven, and no others, decide access by
 * assignment. Ticket 08 removes the hierarchy entirely -- these literals
 * will shrink to nothing then, not grow.
 *
 * NOTE (ticket 06, Task 3 reconciliation): the brief's pre-plan list of
 * seven paths did not match the tree as found. Three paths
 * (`src/app/admin/...`) never existed -- the routes live under
 * `src/app/api/admin/...`. Three page files
 * (`src/app/campaign/[slug]/page.tsx`,
 * `src/app/campaign/[slug]/donate/page.tsx`,
 * `src/app/moderasi/campaigns/[id]/page.tsx`) contain no hierarchy check
 * at all (public pages).
 */
const HIERARCHY_GUARDED_ROUTES = [
  "src/app/api/campaigns/[slug]/payouts/route.ts",
  "src/app/api/campaigns/[slug]/route.ts",
  "src/app/api/campaigns/route.ts",
  "src/app/api/upload/route.ts",
];

const ASSIGNMENT_GUARDED_ROUTES = [
  "src/app/api/admin/reconcile/route.ts",
  "src/app/api/admin/users/[id]/role/route.ts",
  "src/app/api/admin/users/route.ts",
  "src/app/api/campaigns/[slug]/payouts/[id]/approve/route.ts",
  "src/app/api/moderasi/campaigns/[id]/route.ts",
  "src/app/moderasi/layout.tsx",
  "src/app/moderasi/page.tsx",
];

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

function usesHierarchy(source: string): boolean {
  return (
    source.includes("withRoleCheck") ||
    source.includes("isAtLeast") ||
    source.includes("hasRole") ||
    source.includes("requireRole")
  );
}

function usesAssignment(source: string): boolean {
  return (
    source.includes("prisma.userAssignment") ||
    source.includes("Assignment.VERIFIER") ||
    source.includes("Assignment.ADMIN")
  );
}

describe("roles expand scope", () => {
  it("the four account-type routes still enforce the Role hierarchy", () => {
    const offenders = HIERARCHY_GUARDED_ROUTES.filter(
      (file) => !usesHierarchy(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("the seven Admin/Verifier files no longer decide access by hierarchy", () => {
    const offenders = ASSIGNMENT_GUARDED_ROUTES.filter(
      (file) => usesHierarchy(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("exactly the seven Admin/Verifier files decide access by assignment", () => {
    const readers = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => usesAssignment(readFileSync(file, "utf8")));

    expect(readers.sort()).toEqual([...ASSIGNMENT_GUARDED_ROUTES].sort());
  });

  it("the assignment model references ADR 0005", () => {
    expect(readFileSync("prisma/schema.prisma", "utf8")).toContain("ADR 0005");
  });
});
```

- [ ] **Step 2: Run the guard and the full suite**

Run: `npx vitest run src/__tests__/properties/roles-expand-guard.test.ts`
Expected: PASS, 4 tests. If the third test fails listing a file you did not expect, that file's migration (or lack of it) does not match this plan's scope boundary -- stop and reconcile against Global Constraints before proceeding, the way ticket 06's Task 3 had to.

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere. Record the final test and file counts in the commit message.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: pin ticket 07's scope boundary in the guard

Splits the old single GUARDED_ROUTES literal into HIERARCHY_GUARDED_ROUTES
(the four account-type routes, unchanged) and ASSIGNMENT_GUARDED_ROUTES (the
seven Admin/Verifier files, now migrated), and proves the seven no longer
contain any hierarchy check at all -- not just that they also check
assignment. Ticket 08 will shrink both literals as it removes the hierarchy."
```
