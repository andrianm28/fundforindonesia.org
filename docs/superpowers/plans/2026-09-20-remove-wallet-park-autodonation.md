# Remove the Wallet and Park AutoDonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the Kantong Donasi wallet's minting and spending endpoints so no code path can credit a Campaign without posting to the ledger, and make AutoDonation unreachable while keeping its data.

**Architecture:** The wallet is two endpoints and a model. `POST /api/user/topup` credited `User.donationBalance` with no Payment behind it, and `POST /api/balance/donate` spent that balance by writing `Campaign.collectedAmount` directly and creating a Donation with no Payment and no ledger entry — a second writer of a field the settled-payment webhook is meant to own alone. Both are currently refused at runtime by a `WALLET_ENABLED` flag; this plan deletes them outright, drops the `TopUp` model, and adds a guard test so the path cannot return. AutoDonation loses its page, its entry points and its API, keeping its model and rows.

**Tech Stack:** Next.js 14 App Router, Prisma, Postgres, Vitest, fast-check.

**Spec:** `.scratch/prd-compliance-fase-0-2/spec.md` (ticket `.scratch/prd-compliance-fase-0-2/issues/01-remove-wallet-park-autodonation.md`)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    ~/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-20-remove-wallet-park-autodonation.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief
    ~/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-20-remove-wallet-park-autodonation.md ~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- The wallet is removed, not disabled: deleting the endpoints, not flipping `WALLET_ENABLED`, is the deliverable.
- `User.donationBalance` MUST NOT be dropped, and `GET /api/balance` MUST keep working. Five users hold balances totalling Rp 1.371.884, recorded in the doc comment on `src/app/api/balance/route.ts`. Those balances are a liability to honour, and settling them needs either Refund (ticket 32) or Manual Contribution (ticket 34), both Fase 2. Dropping the column here would erase an acknowledged debt to real people.
- The `TopUp` model IS dropped, by migration. Nothing reads it once its endpoint is gone.
- AutoDonation's model and rows survive untouched. Only its page, its entry points and its API are removed.
- No code path may credit a Campaign without posting to the ledger. `Campaign.collectedAmount` is written by the settled-payment webhook alone.
- All amounts are integer rupiah. Never introduce a float into a money path.
- The ledger is append-only: rows are added, never updated or deleted.
- Out of scope, do not build: dropping `User.donationBalance`; settling the five outstanding balances; deleting the `AutoDonation` model or its rows; any change to the payment provider layer, escrow, payouts or refunds; the Campaign lifecycle enum (ticket 02).
- Out of scope, do not build: re-enabling any wallet behaviour behind a new flag, or a replacement top-up that requires a settled Payment. That is a separate decision, not this ticket.

---

### Task 1: Delete the balance-spend endpoint

**Files:**
- Delete: `src/app/api/balance/donate/route.ts`
- Delete: `src/app/api/balance/donate/route.test.ts`
- Delete: `src/lib/utils/balance-deduction.ts`
- Delete: `src/lib/utils/balance-deduction.property.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the route module `@/app/api/balance/donate/route` no longer exists. Task 5's guard test asserts no module under `src/app/api/` other than the provider webhook writes `collectedAmount`.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported route handler under src/app/api/`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi-fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

This task deletes a seam rather than adding one. The behaviour it removes is proven gone by Task 5's guard test, which runs at the same seam across the whole route tree. Do not write a test that imports the deleted module — it will not exist.

- [ ] **Step 1: Confirm `deductBalance` is dead before deleting it**

Run:

```bash
grep -rn "deductBalance" src/ --include=*.ts --include=*.tsx | grep -v generated
```

Expected: only `src/lib/utils/balance-deduction.ts` (its definition) and `src/lib/utils/balance-deduction.property.test.ts` (its test). If any other file appears, STOP and report — the util is live and must not be deleted.

- [ ] **Step 2: Delete the endpoint, its test, and the dead util**

```bash
rm src/app/api/balance/donate/route.ts
rm src/app/api/balance/donate/route.test.ts
rm src/lib/utils/balance-deduction.ts
rm src/lib/utils/balance-deduction.property.test.ts
rmdir src/app/api/balance/donate
```

- [ ] **Step 3: Verify nothing still imports what was deleted**

Run:

```bash
grep -rn "balance/donate\|balance-deduction" src/ --include=*.ts --include=*.tsx | grep -v generated
npx tsc --noEmit 2>&1 | grep -E "balance/donate|balance-deduction" || echo "no type errors from this deletion"
```

Expected: the grep prints nothing, and the tsc filter prints `no type errors from this deletion`. The repo has a pre-existing backlog of type errors unrelated to this work; only errors naming the deleted paths matter here.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS. The baseline before this task is 1031 passed across 99 files. Deleting `balance/donate/route.test.ts` removes its cases and deleting `balance-deduction.property.test.ts` removes three properties, so both the file count and the test count drop. No test should FAIL.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: delete the balance-spend endpoint

POST /api/balance/donate wrote Campaign.collectedAmount directly and created
a Donation with no Payment and no ledger entry, making it a second writer of
a field the settled-payment webhook is meant to own alone. It was refused at
runtime by WALLET_ENABLED; this removes it.

deductBalance went with it: nothing but its own property test used it."
```

### Task 2: Delete the top-up endpoint

**Files:**
- Delete: `src/app/api/user/topup/route.ts`
- Delete: `src/app/api/user/topup/route.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1; this task is independent of it but sequenced after so each lands its own commit.
- Produces: the route module `@/app/api/user/topup/route` no longer exists, and nothing writes the `TopUp` model, which Task 3 relies on before dropping it.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported route handler under src/app/api/`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi-fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

As in Task 1, this removes a seam. Task 5's guard test proves the minting path is gone.

- [ ] **Step 1: Delete the endpoint and its test**

```bash
rm src/app/api/user/topup/route.ts
rm src/app/api/user/topup/route.test.ts
rmdir src/app/api/user/topup
```

- [ ] **Step 2: Verify nothing references it**

Run:

```bash
grep -rn "user/topup\|topUp\|TopUp" src/ --include=*.ts --include=*.tsx | grep -v generated
```

Expected: no hits under `src/app/api/`. Hits remaining in `prisma/schema.prisma` are expected and are Task 3's job. If a hit appears in a page or component, STOP and report: the plan assumed no UI calls this endpoint.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS, with the test count reduced by the deleted file's cases. No FAIL.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: delete the top-up endpoint

POST /api/user/topup credited User.donationBalance with no payment behind it,
so any authenticated user could mint spendable balance. It was refused at
runtime by WALLET_ENABLED; this removes it.

The existing balances it created are NOT removed: five users hold a total of
Rp 1.371.884 and that is a liability to settle, not rows to drop."
```

### Task 3: Drop the TopUp model

**Files:**
- Modify: `prisma/schema.prisma` — remove the `model TopUp` block and the `topUps TopUp[]` relation field on `User`
- Create: a Prisma migration under `prisma/migrations/`

**Interfaces:**
- Consumes: Task 2's deletion — nothing in `src/` reads or writes `TopUp` once its endpoint is gone.
- Produces: the Prisma client no longer exposes `prisma.topUp`. `User.donationBalance` is deliberately untouched and still exposed.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported route handler under src/app/api/`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi-fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

The observable behaviour this task must not break is `GET /api/balance`, which reads `User.donationBalance`. Its existing test at `src/app/api/balance/route.test.ts` exercises that seam and must stay green.

- [ ] **Step 1: Confirm the balance endpoint test exists and passes before the schema changes**

Run: `npx vitest run src/app/api/balance/route.test.ts`
Expected: PASS. This is the regression guard for the constraint that `donationBalance` survives.

- [ ] **Step 2: Remove the model and its relation field**

In `prisma/schema.prisma`, delete this entire block:

```prisma
// ==================== Top Up ====================

model TopUp {
  id            String   @id @default(cuid())
  amount        Int
  paymentMethod String
  status        String   @default("pending") // "pending" | "confirmed" | "failed"
  userId        String
  createdAt     DateTime @default(now())

  // Relations
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
}
```

And on `model User`, delete only this line from the relations block:

```prisma
  topUps        TopUp[]
```

Leave `donationBalance  Int      @default(0)` exactly as it is.

- [ ] **Step 3: Create the migration**

```bash
npx prisma migrate dev --name drop_topup_model --create-only
```

Then read the generated SQL and confirm it contains `DROP TABLE "TopUp"` and does NOT contain any `ALTER TABLE "User" DROP COLUMN "donationBalance"`. If it touches `donationBalance`, STOP and report — that violates a Global Constraint.

- [ ] **Step 4: Regenerate the client and typecheck**

```bash
npx prisma generate
npx tsc --noEmit 2>&1 | grep -i "topup" || echo "no type errors naming TopUp"
```

Expected: `no type errors naming TopUp`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS, including `src/app/api/balance/route.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: drop the TopUp model

Nothing reads or writes it now that the top-up endpoint is gone.

User.donationBalance stays. Five users hold balances totalling Rp 1.371.884
and GET /api/balance still serves them, because those people should be able
to see what they are owed while it is being settled."
```

### Task 4: Park AutoDonation

**Files:**
- Delete: `src/app/donasi-otomatis/page.tsx`
- Delete: `src/app/api/auto-donations/route.ts`, `src/app/api/auto-donations/route.test.ts`
- Delete: `src/app/api/auto-donations/[id]/route.ts`, `src/app/api/auto-donations/[id]/route.test.ts`
- Modify: `src/app/page.tsx` — remove the Donasi Otomatis tile from `quickActionTiles`
- Modify: `src/app/akun/page.tsx:175` — remove the Donasi Otomatis settings link

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no route or page references `/donasi-otomatis`. The `AutoDonation` Prisma model and its rows are untouched and still generated on the client.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the exported route handler under src/app/api/`, plus the rendered page component for the entry-point removals. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi-fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Delete the page and the API**

```bash
rm -r src/app/donasi-otomatis
rm -r src/app/api/auto-donations
```

- [ ] **Step 2: Remove the homepage tile**

In `src/app/page.tsx`, delete exactly this line from the `quickActionTiles` array:

```typescript
  { icon: '🔄', label: 'Donasi Otomatis', href: '/donasi-otomatis', color: '#F3E5F5' },
```

Leave every other tile unchanged.

- [ ] **Step 3: Remove the account settings link**

In `src/app/akun/page.tsx`, delete exactly this line:

```tsx
        <SettingsLink label="Donasi Otomatis" href="/donasi-otomatis" />
```

- [ ] **Step 4: Verify no reference to the removed route remains in app code**

Run:

```bash
grep -rn "donasi-otomatis\|auto-donations\|autoDonation" src/ --include=*.ts --include=*.tsx | grep -v generated
```

Expected: the only remaining hits are in `src/components/home/QuickActionTiles.test.tsx`, which uses its own `mockTiles` fixture and is testing the generic component rather than the app's real tile list. Leave that file alone. If a hit appears anywhere else, remove it.

- [ ] **Step 5: Confirm the model and its rows survive**

Run:

```bash
grep -n "model AutoDonation" prisma/schema.prisma
grep -n "autoDonations" prisma/schema.prisma
```

Expected: both print a match. The model and the `User.autoDonations` relation stay. If either is missing, restore it — removing them violates a Global Constraint.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS. `QuickActionTiles.test.tsx` must still pass, because it renders its own fixture.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: park AutoDonation

The PRD parks the feature rather than deleting it, so the page, its entry
points and its API go while the model and every row stay exactly as they are.

Nothing schedules an AutoDonation today, so parking it removes an unreachable
surface rather than a working feature."
```

### Task 5: Prove no path credits a Campaign outside the ledger

**Files:**
- Create: `src/__tests__/properties/collected-amount-single-writer.test.ts`
- Modify: `src/lib/wallet.ts`

**Interfaces:**
- Consumes: Tasks 1 through 4 — every deletion must already be committed, or this test fails by design.
- Produces: a standing guard. Any future route that writes `Campaign.collectedAmount` fails this test until it is deliberately added to the allowlist.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `the source tree under src/app/api/, read as text`. Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu, termasuk bentuk input yang tidak biasa, kondisi batas, dan jalur kegagalan. Helper internal diuji secara tidak langsung lewat seam, tidak pernah langsung, meskipun fungsi-fungsi itu diekspor. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

This is the one task whose seam is the source tree rather than a handler, because the property being asserted — that no OTHER route exists — cannot be observed by calling any single handler. The allowlist is a known literal, not something the test recomputes by scanning.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/properties/collected-amount-single-writer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Campaign.collectedAmount is the headline "dana terkumpul" figure. It is
 * owned by exactly one writer: the settled-payment webhook, which posts the
 * matching ledger entries in the same transaction.
 *
 * The wallet used to be a second writer -- POST /api/balance/donate
 * incremented it with no Payment and no ledger entry -- so the figure could
 * drift away from the ledger with nothing to reconcile it against. This test
 * exists so that path cannot come back unnoticed.
 *
 * The allowlist is a literal. Adding a file to it is a deliberate decision
 * that a reviewer sees in the diff.
 */
const ALLOWED_WRITERS = ["src/app/api/webhooks/[provider]/route.ts"];

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

describe("Campaign.collectedAmount has exactly one writer", () => {
  it("no route outside the allowlist writes collectedAmount", () => {
    const offenders = walk("src/app/api")
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          source.includes("collectedAmount:") &&
          (source.includes("increment") || source.includes("decrement"))
        );
      })
      .filter((file) => !ALLOWED_WRITERS.includes(file));

    expect(offenders).toEqual([]);
  });

  it("the wallet's spend and mint endpoints no longer exist", () => {
    const routes = walk("src/app/api");

    expect(routes).not.toContain("src/app/api/balance/donate/route.ts");
    expect(routes).not.toContain("src/app/api/user/topup/route.ts");
  });

  it("the read-only balance endpoint still exists, because five users are owed money", () => {
    const routes = walk("src/app/api");

    expect(routes).toContain("src/app/api/balance/route.ts");
  });
});
```

- [ ] **Step 2: Run the test to verify it passes on the cleaned tree**

Run: `npx vitest run src/__tests__/properties/collected-amount-single-writer.test.ts`
Expected: PASS, 3 tests.

If it FAILS on the first case, a route this plan did not account for writes `collectedAmount` — report the offending path rather than adding it to the allowlist.

- [ ] **Step 3: Verify the test actually fails when the rule is broken**

A guard that cannot fail is worthless. Temporarily prove it bites:

```bash
mkdir -p "src/app/api/__guardcheck"
printf 'export async function POST() {\n  await prisma.campaign.update({ data: { collectedAmount: { increment: 1 } } });\n}\n' > "src/app/api/__guardcheck/route.ts"
npx vitest run src/__tests__/properties/collected-amount-single-writer.test.ts
```

Expected: FAIL, with `src/app/api/__guardcheck/route.ts` listed in the offenders array.

Then remove it and confirm green again:

```bash
rm -r "src/app/api/__guardcheck"
npx vitest run src/__tests__/properties/collected-amount-single-writer.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 4: Rewrite the wallet module's doc comment**

`src/lib/wallet.ts` still describes a feature that is merely disabled. `WALLET_ENABLED` now has no readers — Tasks 1 and 2 deleted both — but `WALLET_DISABLED_MESSAGE` is still imported by `src/app/akun/page.tsx:9` to explain the balance card. Replace the whole file with:

```typescript
/**
 * The "Kantong Donasi" wallet has been removed.
 *
 * Both of its endpoints are gone: `POST /api/user/topup`, which credited
 * `User.donationBalance` with no payment behind it, and
 * `POST /api/balance/donate`, which spent that balance by writing
 * `Campaign.collectedAmount` directly with no Payment and no ledger entry.
 * The guard test at
 * `src/__tests__/properties/collected-amount-single-writer.test.ts` keeps
 * them gone.
 *
 * What survives is `User.donationBalance` and the read-only
 * `GET /api/balance`, because five users hold balances totalling
 * Rp 1.371.884. That money is owed to them. It cannot be refunded through
 * the system yet -- refunds do not exist -- so the balance stays visible and
 * unspendable until it is settled, which is tracked separately from this
 * work.
 *
 * This message is what the account page shows those users so they understand
 * the balance is temporarily unspendable rather than gone.
 */
export const WALLET_DISABLED_MESSAGE =
  "Fitur Kantong Donasi sedang tidak tersedia. Anda tetap bisa berdonasi langsung ke campaign pilihan Anda.";
```

Note this deletes the `WALLET_ENABLED` export. Confirm nothing imports it:

```bash
grep -rn "WALLET_ENABLED" src/ --include=*.ts --include=*.tsx | grep -v generated
```

Expected: no output.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS, with no FAIL anywhere. Record the final test and file counts in the commit message.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: guard Campaign.collectedAmount against a second writer

The wallet is gone, but nothing stopped an equivalent path being written
again. This asserts that only the settled-payment webhook increments
collectedAmount, that the two wallet endpoints stay deleted, and that the
read-only balance endpoint stays alive for the five users who are owed money.

The allowlist is a literal, so adding a writer is a visible decision rather
than an accident.

wallet.ts now documents a removed feature rather than a disabled one, and
WALLET_ENABLED is gone with its last reader."
```
