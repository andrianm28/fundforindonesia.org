# Assignment Lifecycle Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Admin can grant or revoke someone's Verifier or Admin assignment as its own explicit API action, independent of their Role, with a durable audit trail of who did it and when.

**Architecture:** One new route, `src/app/api/admin/users/[id]/assignments/route.ts`, exporting `POST` (grant) and `DELETE` (revoke), gated by the existing `withAssignmentCheck(Assignment.ADMIN, ...)` and mirroring `src/app/api/admin/users/[id]/role/route.ts`'s structure exactly. `UserAssignment` (shipped, in production use via `src/lib/auth.ts`'s session refresh) is untouched — granting inserts a row, revoking deletes one, exactly as that file already assumes. A new, purely additive model, `AssignmentAuditEntry`, records one row per grant or revoke event so the actor and timestamp survive even across a revoke-then-regrant cycle, which a soft-delete on `UserAssignment` itself would not preserve.

**Tech Stack:** Next.js 14 App Router, Prisma, Postgres, Vitest.

**Spec:** `.scratch/prd-compliance-fase-0-2/spec.md` (ticket `.scratch/prd-compliance-fase-0-2/issues/42-assignment-lifecycle-management.md`, narrowed to API-only during this pass; UI is ticket 44)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    ~/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-22-assignment-lifecycle-management.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief
    ~/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-22-assignment-lifecycle-management.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- The two-person rule does NOT apply to granting or revoking an assignment. This is an Admin-only administrative action, distinct from the money-moving two-person actions (Payout, Refund). Do not add a second-approver requirement.
- `src/app/api/admin/users/[id]/role/route.ts` is NOT modified to auto-sync assignments on role change. ADR 0005 is the reason: Verifier and Admin are independent of Role by design, and auto-syncing would recouple them. A test must prove role-change does not touch `UserAssignment` or `AssignmentAuditEntry`.
- `UserAssignment`'s shape, columns, composite primary key `[userId, assignment]`, and query pattern are NOT changed. `src/lib/auth.ts`'s session refresh already depends on its current shape; nothing here reworks already-shipped, already-reviewed code.
- UI is out of scope. Do not add anything to `src/app/admin/users/page.tsx` or any other page. That is ticket 44, blocked by this one.
- Revoking your own ADMIN assignment through this route is refused, mirroring the sibling role route's self-demotion block, sharpened: Assignment, not Role, is what actually gates these routes since ticket 07, so losing your own last ADMIN assignment with no other admin around is a real lockout.
- All amounts are integer rupiah; not directly relevant here, but a standing project-wide constraint. The ledger is append-only; also not directly relevant here, but the same append-only principle applies to `AssignmentAuditEntry` — rows are created, never updated or deleted.

---

### Task 1: Grant an assignment

**Files:**
- Modify: `prisma/schema.prisma` — add the `AssignmentAuditAction` enum, the `AssignmentAuditEntry` model, and two new relation fields on `User`
- Create: a Prisma migration under `prisma/migrations/`
- Create: `src/app/api/admin/users/[id]/assignments/route.ts`
- Create: `src/app/api/admin/users/[id]/assignments/route.test.ts`

**Interfaces:**
- Consumes: `withAssignmentCheck(requiredAssignment, handler)` and `Assignment` from `@/generated/prisma/client` (both already shipped).
- Produces: `export const POST` and (Task 2 adds) `export const DELETE` in the same file. `AssignmentAuditEntry` (fields: `id`, `userId`, `assignment`, `action: AssignmentAuditAction`, `actedById`, `actedAt`) is the model Task 3's regression test asserts is never written by the role route.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported route handler of src/app/api/admin/users/[id]/assignments/route.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Modify `prisma/schema.prisma`**

Add this enum and model immediately after the existing `UserAssignment` model (search for `model UserAssignment {` and its closing `}`, insert after it):

```prisma
enum AssignmentAuditAction {
  GRANTED
  REVOKED
}

/// One row per grant or revoke event, kept even after the UserAssignment
/// row itself is deleted on revoke. This is what lets granting, revoking,
/// and regranting the same assignment keep its full history -- a
/// soft-delete on UserAssignment itself would not, since that model's
/// composite primary key assumes one row per currently-held assignment.
model AssignmentAuditEntry {
  id         String                @id @default(cuid())
  userId     String
  assignment Assignment
  action     AssignmentAuditAction
  actedById  String
  actedAt    DateTime              @default(now())

  // Relations
  user    User @relation("AssignmentAuditSubject", fields: [userId], references: [id], onDelete: Cascade)
  actedBy User @relation("AssignmentAuditActor", fields: [actedById], references: [id])

  @@index([userId])
  @@index([assignment])
}
```

Then, in `model User`, add exactly these two lines to the relations block, immediately after the existing `assignments   UserAssignment[]` line. `User` needs two distinct back-relations to `AssignmentAuditEntry` because it is referenced twice -- once as the subject whose assignment changed, once as the actor who changed it:

```prisma
  assignmentAuditsAsSubject AssignmentAuditEntry[] @relation("AssignmentAuditSubject")
  assignmentAuditsAsActor   AssignmentAuditEntry[] @relation("AssignmentAuditActor")
```

- [ ] **Step 2: Generate the migration**

```bash
npx prisma migrate dev --name add_assignment_audit_entry --create-only
```

Read the generated SQL and confirm it contains `CREATE TABLE "AssignmentAuditEntry"` and does NOT touch the existing `UserAssignment` table at all. If it touches `UserAssignment`, STOP and report — that violates a Global Constraint.

- [ ] **Step 3: Regenerate the client and typecheck**

```bash
npx prisma generate
npx tsc --noEmit 2>&1 | grep -i "assignmentauditentry" || echo "no type errors naming AssignmentAuditEntry"
```

Expected: `no type errors naming AssignmentAuditEntry`.

- [ ] **Step 4: Write the failing test**

Create `src/app/api/admin/users/[id]/assignments/route.test.ts` with exactly this content:

```typescript
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userAssignment: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    assignmentAuditEntry: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockUpsert = prisma.userAssignment.upsert as unknown as Mock;
const mockAuditCreate = prisma.assignmentAuditEntry.create as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/users/user-2/assignments", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function routeContext(id = "user-2") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/users/[id]/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN"] } });
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockAuditCreate.mockResolvedValue({});
    mockNotificationCreate.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 403 for a Verifier who does not hold the Admin assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", role: "ADMIN", assignments: [] } });
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid assignment value", async () => {
    const response = await POST(createRequest({ assignment: "SUPERADMIN" }), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 when assignment is missing from the body", async () => {
    const response = await POST(createRequest({}), routeContext());
    expect(response.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("grants the assignment, records the audit entry, and notifies the user", async () => {
    const response = await POST(createRequest({ assignment: "VERIFIER" }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual({ userId: "user-2", assignment: "VERIFIER", action: "GRANTED" });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { userId_assignment: { userId: "user-2", assignment: "VERIFIER" } },
      create: { userId: "user-2", assignment: "VERIFIER" },
      update: {},
    });

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-2",
        assignment: "VERIFIER",
        action: "GRANTED",
        actedById: "admin-1",
      },
    });

    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });

  it("is idempotent: granting an already-held assignment succeeds without erroring", async () => {
    mockUpsert.mockResolvedValue({ userId: "user-2", assignment: "ADMIN" });
    const response = await POST(createRequest({ assignment: "ADMIN" }), routeContext());
    expect(response.status).toBe(201);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run "src/app/api/admin/users/[id]/assignments/route.test.ts"`
Expected: FAIL with a module-not-found error for `./route`.

- [ ] **Step 6: Write the minimal implementation**

Create `src/app/api/admin/users/[id]/assignments/route.ts` with exactly this content:

```typescript
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";

const VALID_ASSIGNMENTS: Assignment[] = ["VERIFIER", "ADMIN"];

export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { assignment } = body;

  if (!assignment || !VALID_ASSIGNMENTS.includes(assignment as Assignment)) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const session = await getServerSession();
  const actedById = session!.user.id as string;

  await prisma.userAssignment.upsert({
    where: { userId_assignment: { userId: id, assignment: assignment as Assignment } },
    create: { userId: id, assignment: assignment as Assignment },
    update: {},
  });

  await prisma.assignmentAuditEntry.create({
    data: {
      userId: id,
      assignment: assignment as Assignment,
      action: "GRANTED",
      actedById,
    },
  });

  await prisma.notification.create({
    data: {
      type: "assignment_granted",
      title: "Assignment Granted",
      message: `You have been granted the ${assignment} assignment.`,
      userId: id,
      link: "/akun",
    },
  });

  return NextResponse.json({ userId: id, assignment, action: "GRANTED" }, { status: 201 });
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run "src/app/api/admin/users/[id]/assignments/route.test.ts"`
Expected: PASS, 7 tests.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS, no FAIL anywhere.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: grant an assignment as its own Admin action

New AssignmentAuditEntry model, purely additive -- UserAssignment's shape,
columns, and composite primary key are untouched, matching what auth.ts's
session refresh already assumes.

POST /api/admin/users/[id]/assignments upserts the UserAssignment row
(idempotent: granting an already-held assignment succeeds without erroring),
records who granted it and when, and notifies the affected user. Gated by
withAssignmentCheck(Assignment.ADMIN, ...), mirroring the sibling role route
exactly in shape."
```

### Task 2: Revoke an assignment

**Files:**
- Modify: `src/app/api/admin/users/[id]/assignments/route.ts` — add the `DELETE` export
- Modify: `src/app/api/admin/users/[id]/assignments/route.test.ts` — add the revoke test suite

**Interfaces:**
- Consumes: `withAssignmentCheck`, `Assignment`, `VALID_ASSIGNMENTS` from Task 1's same file (same-file constant, no new import needed).
- Produces: `export const DELETE` in the same route file. Nothing later depends on new exports from this task beyond what Task 1 already produced.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported route handler of src/app/api/admin/users/[id]/assignments/route.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing test**

First, change the existing import line near the top of `src/app/api/admin/users/[id]/assignments/route.test.ts` from:

```typescript
import { POST } from "./route";
```

to:

```typescript
import { POST, DELETE } from "./route";
```

Then append this to the end of the file (after the existing `describe("POST ...")` block's closing `});`, as a new top-level `describe`):

```typescript
const mockFindUnique = prisma.userAssignment.findUnique as unknown as Mock;
const mockDelete = prisma.userAssignment.delete as unknown as Mock;

function deleteRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/users/user-2/assignments", {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("DELETE /api/admin/users/[id]/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN"] } });
    mockFindUnique.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockDelete.mockResolvedValue({ userId: "user-2", assignment: "VERIFIER" });
    mockAuditCreate.mockResolvedValue({});
    mockNotificationCreate.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", role: "ADMIN", assignments: [] } });
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());
    expect(response.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid assignment value", async () => {
    const response = await DELETE(deleteRequest({ assignment: "SUPERADMIN" }), routeContext());
    expect(response.status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses to let an admin revoke their own ADMIN assignment", async () => {
    const response = await DELETE(deleteRequest({ assignment: "ADMIN" }), routeContext("admin-1"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Cannot revoke your own ADMIN assignment");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("allows an admin to revoke their own VERIFIER assignment", async () => {
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext("admin-1"));
    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledOnce();
  });

  it("returns 404 when the user does not currently hold the assignment", async () => {
    mockFindUnique.mockResolvedValue(null);
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());

    expect(response.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("revokes the assignment, records the audit entry, and notifies the user", async () => {
    const response = await DELETE(deleteRequest({ assignment: "VERIFIER" }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ userId: "user-2", assignment: "VERIFIER", action: "REVOKED" });

    expect(mockDelete).toHaveBeenCalledWith({
      where: { userId_assignment: { userId: "user-2", assignment: "VERIFIER" } },
    });

    expect(mockAuditCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-2",
        assignment: "VERIFIER",
        action: "REVOKED",
        actedById: "admin-1",
      },
    });

    expect(mockNotificationCreate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/api/admin/users/[id]/assignments/route.test.ts"`
Expected: FAIL with `DELETE` not exported from `./route`.

- [ ] **Step 3: Write the minimal implementation**

Append this to `src/app/api/admin/users/[id]/assignments/route.ts`, after the existing `POST` export:

```typescript

export const DELETE = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json();
  const { assignment } = body;

  if (!assignment || !VALID_ASSIGNMENTS.includes(assignment as Assignment)) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const session = await getServerSession();
  const actedById = session!.user.id as string;

  if (actedById === id && assignment === "ADMIN") {
    return NextResponse.json(
      { error: "Cannot revoke your own ADMIN assignment" },
      { status: 400 }
    );
  }

  const existing = await prisma.userAssignment.findUnique({
    where: { userId_assignment: { userId: id, assignment: assignment as Assignment } },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "User does not currently hold this assignment" },
      { status: 404 }
    );
  }

  await prisma.userAssignment.delete({
    where: { userId_assignment: { userId: id, assignment: assignment as Assignment } },
  });

  await prisma.assignmentAuditEntry.create({
    data: {
      userId: id,
      assignment: assignment as Assignment,
      action: "REVOKED",
      actedById,
    },
  });

  await prisma.notification.create({
    data: {
      type: "assignment_revoked",
      title: "Assignment Revoked",
      message: `Your ${assignment} assignment has been revoked.`,
      userId: id,
      link: "/akun",
    },
  });

  return NextResponse.json({ userId: id, assignment, action: "REVOKED" }, { status: 200 });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/api/admin/users/[id]/assignments/route.test.ts"`
Expected: PASS, 14 tests (7 from Task 1, 7 new).

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit 2>&1 | grep -i "assignments/route"`
Expected: no output.

Run: `npx vitest run`
Expected: PASS, no FAIL anywhere. Record the final test and file counts in the commit message.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: revoke an assignment as its own Admin action

DELETE /api/admin/users/[id]/assignments deletes the UserAssignment row,
records who revoked it and when, and notifies the affected user.

Refuses to let an admin revoke their own ADMIN assignment -- the sharper
version of the sibling role route's self-demotion block, since Assignment
is what withAssignmentCheck(Assignment.ADMIN) actually checks on every
migrated route since ticket 07, not Role. Revoking your own VERIFIER
assignment is unaffected: it carries no lockout risk on this route.

Returns 404 rather than silently succeeding when the user does not
currently hold the assignment being revoked -- checked explicitly via
findUnique before the delete, not inferred from a caught Prisma error."
```

### Task 3: Prove the role route never touches assignments

**Files:**
- Create: `src/app/api/admin/users/[id]/role/route.assignments-unaffected.test.ts`

**Interfaces:**
- Consumes: the existing, unmodified `PATCH` export from `src/app/api/admin/users/[id]/role/route.ts`.
- Produces: nothing later depends on.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported PATCH handler of src/app/api/admin/users/[id]/role/route.ts`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

This is a regression test, not a feature test: it proves a Global Constraint (role change must never touch assignments) against a file this task does not modify. A sibling-file test, not an edit to the existing `role/route.test.ts`, matching the precedent `route.assignment-gate.test.ts` already set alongside the moderation route in ticket 07 -- the existing test file's scope stays exactly what it already tests.

**Note on a ticket criterion this plan does not add a new test for:** "revoking a user's last Admin assignment actually removes their access on the very next request, no stale session window" is satisfied by composition, not by a new test here. `src/lib/auth.ts`'s session refresh already re-queries `UserAssignment` on every `getServerSession()` call -- proven by the existing `src/lib/auth.test.ts` from ticket 07 -- and Task 2's `DELETE` handler deletes the actual row that query reads. Combining an already-tested "always reads fresh" session with this task's "revoke deletes the real row" is what makes the property true; no separate integration test is added for it in this plan.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/admin/users/[id]/role/route.assignments-unaffected.test.ts` with exactly this content:

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
    userAssignment: {
      create: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    assignmentAuditEntry: {
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
const mockAssignmentCreate = prisma.userAssignment.create as unknown as Mock;
const mockAssignmentUpsert = prisma.userAssignment.upsert as unknown as Mock;
const mockAssignmentDelete = prisma.userAssignment.delete as unknown as Mock;
const mockAssignmentDeleteMany = prisma.userAssignment.deleteMany as unknown as Mock;
const mockAuditCreate = prisma.assignmentAuditEntry.create as unknown as Mock;

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

describe("PATCH /api/admin/users/[id]/role never touches assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN"] } });
    mockUserUpdate.mockResolvedValue({ id: "user-2", name: "Someone", email: "someone@test.com", role: "ADMIN" });
    mockNotificationCreate.mockResolvedValue({});
  });

  it("promoting a user to ADMIN writes only role, never a UserAssignment or an audit entry", async () => {
    const response = await PATCH(createRequest({ role: "ADMIN" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
    expect(mockAssignmentUpsert).not.toHaveBeenCalled();
    expect(mockAssignmentDelete).not.toHaveBeenCalled();
    expect(mockAssignmentDeleteMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("demoting a user to DONOR writes only role, never a UserAssignment or an audit entry", async () => {
    mockUserUpdate.mockResolvedValue({ id: "user-2", name: "Someone", email: "someone@test.com", role: "DONOR" });
    const response = await PATCH(createRequest({ role: "DONOR" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
    expect(mockAssignmentUpsert).not.toHaveBeenCalled();
    expect(mockAssignmentDelete).not.toHaveBeenCalled();
    expect(mockAssignmentDeleteMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes immediately**

Run: `npx vitest run "src/app/api/admin/users/[id]/role/route.assignments-unaffected.test.ts"`
Expected: PASS, 2 tests, immediately -- this is a regression test against code this task does not modify, so there is no RED phase. If it fails, the role route has started touching assignments somewhere and that is the real bug to fix, not this test.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS, no FAIL anywhere. Record the final test and file counts in the commit message.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: prove role changes never touch assignments

Regression test against src/app/api/admin/users/[id]/role/route.ts, which
this task does not modify. ADR 0005: Verifier and Admin are independent of
Role by design, and auto-syncing them would recouple the two things this
whole migration exists to keep apart. A sibling test file, not an edit to
the existing role route test -- that file's scope stays exactly what it
already tests."
```
