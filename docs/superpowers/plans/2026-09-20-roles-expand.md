# Roles Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model Verifier and Admin as holdable assignments beside the existing Role rank, backfilled from current roles, with access still governed by the hierarchy.

**Architecture:** Expand phase of an expand-contract migration (tickets 06 to 08). A new `Assignment` enum (`VERIFIER`, `ADMIN`) and a `UserAssignment` join model with a composite primary key land beside `User.role`; one migration backfills rows (ADMIN gains both, MODERATOR gains Verifier); `withRoleCheck`, `isAtLeast`, and every guarded route keep working exactly as today until tickets 07-08.

**Tech Stack:** Next.js 14 App Router, Prisma, Postgres, Vitest.

**Spec:** `.scratch/prd-compliance-fase-0-2/spec.md` (ticket `.scratch/prd-compliance-fase-0-2/issues/06-roles-expand.md`)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    ~/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-20-roles-expand.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief
    ~/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-20-roles-expand.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- Assignments are exactly `VERIFIER` and `ADMIN`; holding both is two rows, never a special case.
- The backfill mapping below is verbatim: a `User` with `role = 'ADMIN'` gains `VERIFIER` and `ADMIN` rows; a `User` with `role = 'MODERATOR'` gains a `VERIFIER` row; `CAMPAIGN_CREATOR` and `DONOR` gain nothing.
- The `Role` hierarchy still works and still governs access in this ticket: `withRoleCheck`, `isAtLeast`, `hasRole`, `requireRole`, and every guarded route behave exactly as today.
- The model carries a documentation comment referencing ADR 0005.
- New users default to `DONOR` and gain no assignments; assigning Verifier or Admin to anyone belongs to later tickets, not this one.
- All amounts are integer rupiah. Never introduce a float into a money path.
- The ledger is append-only: rows are added, never updated or deleted.
- Out of scope, do not build: migrating any guard to assignments (tickets 07-08); dropping, weakening, or reordering the `Role` enum; any UI for granting assignments; any change to the payment provider layer, escrow, payouts, refunds, fees, or the campaign lifecycle.

---

### Task 1: Add the Assignment enum and the UserAssignment model

**Files:**
- Modify: `prisma/schema.prisma` — add the `Assignment` enum, the `UserAssignment` model with ADR 0005 doc comment, and the `assignments` relation on `User`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `prisma.userAssignment` on the generated client; the `Assignment` enum value importable from `@/generated/prisma/client`. Task 2's migration writes this table; Task 3's guard asserts the model exists.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `prisma/schema.prisma and the structural migration SQL under prisma/migrations/, read as text`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode. Penambahan model ini tidak punya permukaan HTTP, jadi tidak ada route handler yang diuji di sini; regresinya adalah full suite yang tetap hijau karena belum ada yang membaca tabel baru.

- [ ] **Step 1: Add the enum, model, and relation**

In `prisma/schema.prisma`, immediately above the `enum Role` block, add exactly:

```prisma
enum Assignment {
  VERIFIER
  ADMIN
}
```

Immediately below the `model User` closing brace, add exactly:

```prisma
/// Verifier and Admin are assignments a person holds, not ranks.
/// One person may hold both; holding both is two rows, never a special
/// case. See ADR 0005. The `Role` hierarchy still governs access until
/// tickets 07-08 migrate the guards; this model only records who holds
/// what in the meantime.
model UserAssignment {
  userId     String
  assignment Assignment
  assignedAt DateTime   @default(now())

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, assignment])
  @@index([assignment])
}
```

On `model User`, inside the relations block next to the other relation
fields, add exactly one line:

```prisma
  assignments   UserAssignment[]
```

Keep the field alignment consistent with the surrounding lines. Do not touch
`role`, the `Role` enum, or any other model.

- [ ] **Step 2: Create the structural migration**

Run:

```bash
npx prisma migrate dev --name add_user_assignments --create-only
```

There is no live database in this environment, so if that command refuses,
generate the structural SQL offline instead:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/roles_struct.sql
```

Either way, this task's migration holds ONLY the structural DDL
(`CREATE TYPE "Assignment"`, `CREATE TABLE "UserAssignment"`, indexes).
The backfill `INSERT`s are Task 2's job in a second migration. Read the
file back and confirm it contains no `INSERT`, no `UPDATE`, and no mention
of `"User"` beyond the foreign key.

- [ ] **Step 3: Regenerate the client and typecheck**

```bash
npx prisma generate
npx tsc --noEmit 2>&1 | grep -i "assignment" || echo "no type errors naming assignments"
```

Expected: `no type errors naming assignments`. The repo has a pre-existing
backlog of type errors unrelated to this work; only errors naming the new
model or enum matter here.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS, 98 files, no FAIL. Nothing reads the new table yet, so
nothing else may change behavior.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Assignment enum and UserAssignment model

Verifier and Admin become holdable assignments beside the Role rank, per
ADR 0005. No guard reads them yet; the hierarchy still governs access."
```

### Task 2: Backfill assignments from current roles

**Files:**
- Create: a Prisma migration under `prisma/migrations/` holding only the backfill `INSERT`s
- Create: `src/__tests__/roles-backfill.test.ts` — asserts the migration SQL content

**Interfaces:**
- Consumes: Task 1's `UserAssignment` table.
- Produces: every existing `ADMIN` holds both assignments and every existing
  `MODERATOR` holds Verifier once the migration runs. Task 3 relies on the
  mapping below matching the Global Constraints table.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the backfill migration SQL under prisma/migrations/, read as text`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode. Backfill tidak punya permukaan HTTP, jadi tidak ada route handler yang diuji di sini; regresinya adalah full suite yang tetap hijau.

- [ ] **Step 1: Write the backfill migration**

Create the migration the same way as Task 1 (`migrate dev --create-only`
with a `--name backfill_user_assignments`, or hand-place the directory
following the existing `prisma/migrations/` naming convention
`YYYYMMDDHHMMSS_backfill_user_assignments/` with a `migration.sql` inside).
Its `migration.sql` must contain exactly these statements and nothing else:

```sql
-- Backfill assignments from the Role rank each user holds.
-- ADMIN gains both assignments; MODERATOR gains Verifier.
INSERT INTO "UserAssignment" ("userId", "assignment")
SELECT "id", 'VERIFIER' FROM "User" WHERE "role" = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "UserAssignment" ("userId", "assignment")
SELECT "id", 'ADMIN' FROM "User" WHERE "role" = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "UserAssignment" ("userId", "assignment")
SELECT "id", 'VERIFIER' FROM "User" WHERE "role" = 'MODERATOR'
ON CONFLICT DO NOTHING;
```

`ON CONFLICT DO NOTHING` makes the migration re-runnable. It MUST NOT
contain any `UPDATE` or `DELETE`, and MUST NOT touch the `"role"` column.
If the generator emits anything else into this file, remove it — this
migration is backfill only. `CAMPAIGN_CREATOR` and `DONOR` rows gain
nothing, by the absence of any statement naming them.

- [ ] **Step 2: Write the migration-content test**

Create `src/__tests__/roles-backfill.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function backfillSql(): string {
  const dir = "prisma/migrations";
  const match = readdirSync(dir).filter((d) =>
    d.endsWith("_backfill_user_assignments")
  );
  expect(match).toHaveLength(1);
  return readFileSync(join(dir, match[0], "migration.sql"), "utf8");
}

describe("roles backfill migration", () => {
  it("gives ADMIN both assignments", () => {
    const sql = backfillSql();
    expect(sql).toContain(`'VERIFIER' FROM "User" WHERE "role" = 'ADMIN'`);
    expect(sql).toContain(`'ADMIN' FROM "User" WHERE "role" = 'ADMIN'`);
  });

  it("gives MODERATOR the Verifier assignment", () => {
    const sql = backfillSql();
    expect(sql).toContain(`'VERIFIER' FROM "User" WHERE "role" = 'MODERATOR'`);
  });

  it("gives CAMPAIGN_CREATOR and DONOR nothing and never touches the role column", () => {
    const sql = backfillSql();
    expect(sql).not.toContain("CAMPAIGN_CREATOR");
    expect(sql).not.toContain("DONOR");
    expect(sql).not.toMatch(/UPDATE\s+"User"/);
    expect(sql).not.toMatch(/DELETE\s+FROM/);
  });
});
```

- [ ] **Step 3: Run the test and the full suite**

Run: `npx vitest run src/__tests__/roles-backfill.test.ts`
Expected: PASS, 3 tests.

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: backfill UserAssignment rows from Role ranks

ADMIN gains VERIFIER and ADMIN, MODERATOR gains VERIFIER. Re-runnable via
ON CONFLICT DO NOTHING; the role column itself is never written."
```

### Task 3: Guard the hierarchy and pin the expand scope

**Files:**
- Create: `src/__tests__/properties/roles-expand-guard.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2 — the model exists and the backfill mapping is committed.
- Produces: a standing guard. Any route that drops its hierarchy check, or any
  premature move to assignments, fails this test until deliberately reviewed.
  Tickets 07-08 extend its literals as they migrate guards.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the source tree under src/ plus prisma/schema.prisma, read as text`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Properti yang diassert — tidak ada yang berubah — tidak bisa diobservasi dengan memanggil satu handler pun, jadi pemindaian pohon sumber adalah seam yang benar, mengikuti preseden guard ticket 01 dan 02. Daftar route yang dijaga dan pola penegasan assignment adalah literal yang diketahui, bukan sesuatu yang dihitung ulang oleh test.

- [ ] **Step 1: Write the guard test**

Create `src/__tests__/properties/roles-expand-guard.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Ticket 06 only records assignments; the Role hierarchy still governs
 * every access decision. This test pins that scope two ways: the exact
 * set of routes guarded by the hierarchy cannot shrink unnoticed, and
 * nothing may enforce assignments yet.
 *
 * Tickets 07-08 will extend these literals deliberately, one reviewed
 * diff at a time.
 */
const GUARDED_ROUTES = [
  "src/app/admin/reconcile/route.ts",
  "src/app/admin/users/[id]/role/route.ts",
  "src/app/admin/users/route.ts",
  "src/app/api/upload/route.ts",
  "src/app/campaign/[slug]/donate/page.tsx",
  "src/app/campaign/[slug]/page.tsx",
  "src/app/moderasi/campaigns/[id]/page.tsx",
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

describe("roles expand scope", () => {
  it("every guarded route still enforces the Role hierarchy", () => {
    const offenders = GUARDED_ROUTES.filter(
      (file) => !usesHierarchy(readFileSync(file, "utf8"))
    );

    expect(offenders).toEqual([]);
  });

  it("no route enforces assignments yet", () => {
    const offenders = walk("src")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          source.includes("prisma.userAssignment") ||
          source.includes("Assignment.VERIFIER") ||
          source.includes("Assignment.ADMIN")
        );
      });

    expect(offenders).toEqual([]);
  });

  it("the assignment model references ADR 0005", () => {
    expect(readFileSync("prisma/schema.prisma", "utf8")).toContain("ADR 0005");
  });
});
```

Before committing to this literal, verify the `GUARDED_ROUTES` list against
the tree: run

```bash
grep -rln "withRoleCheck\|isAtLeast\|hasRole\|requireRole" src/app src/components --include=*.ts --include=*.tsx | grep -v generated | grep -v ".test." | sort
```

and reconcile. The list above was built from a pre-plan grep and may miss a
file or include one that no longer uses the hierarchy. Every route file that
enforces the hierarchy MUST be in the literal; no file that does not
enforce it may be. Adjust the literal to the tree as found — but any file
you must ADD to the literal beyond the seven above, report in your commit
report as a plan deviation for the reviewer to judge. Do not silently drop
a file from the literal to make the test pass.

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/properties/roles-expand-guard.test.ts`
Expected: PASS, 3 tests.

If the second case FAILS on a hand-written file, that file enforces
assignments early — remove the enforcement, not the assertion. If the first
case FAILS, a guard was dropped — restore it.

- [ ] **Step 3: Verify the test actually fails when the rule is broken**

A guard that cannot fail is worthless. Temporarily prove it bites:

```bash
mkdir -p "src/app/api/__guardcheck"
printf 'import { prisma } from "@/lib/prisma";\nexport async function GET() {\n  return Response.json(await prisma.userAssignment.findMany());\n}\n' > "src/app/api/__guardcheck/route.ts"
npx vitest run src/__tests__/properties/roles-expand-guard.test.ts
```

Expected: FAIL, with `src/app/api/__guardcheck/route.ts` listed in the offenders array.

Then remove it and confirm green again:

```bash
rm -r "src/app/api/__guardcheck"
npx vitest run src/__tests__/properties/roles-expand-guard.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere. Record the final test and file counts
in the commit message.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: guard the roles-expand scope

The hierarchy still guards exactly these routes and nothing enforces
assignments yet. Tickets 07-08 extend the literals deliberately."
```
