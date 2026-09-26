import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A Registration's status has one writer: the Volunteer Trip module
 * (src/lib/volunteer/trip.ts). Hold, Settlement's confirm, the Payment-
 * lapsed expiry, Volunteer cancel, Batch cancel and the hold sweep all live
 * there, under its one lock order and beside the Trip Fee Refund policy. A
 * second writer elsewhere could flip a status without the lock, or cancel
 * a paid seat without its Refund, and nothing would notice.
 *
 * Recognises a write as a Prisma `registration.<create|update|upsert…>(`
 * call, or raw `UPDATE "Registration"` / `INSERT INTO "Registration"` SQL.
 * Every such write is counted, not only ones naming `status`: a created
 * Registration is born with one, and an update's data may be built
 * elsewhere.
 *
 * The allowlist is a literal. Adding a file to it is a deliberate decision
 * that a reviewer sees in the diff.
 */
const ALLOWED_WRITERS = ["src/lib/volunteer/trip.ts"];

const REGISTRATION_WRITE =
  /\bregistration\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(|\b(UPDATE|INSERT\s+INTO)\s+"Registration"/;

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

const appFiles = () =>
  walk("src")
    .filter((file) => !file.startsWith("src/generated/"))
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));

describe("Registration status has one writer", () => {
  it("no file but the Volunteer Trip module writes a Registration", () => {
    const writers = appFiles().filter((file) => REGISTRATION_WRITE.test(readFileSync(file, "utf8")));

    expect(writers).toEqual(ALLOWED_WRITERS);
  });

  // Guards the guard: pins which spellings it recognises and which it
  // leaves alone, so it cannot pass by silently matching nothing.
  it("recognises Prisma and raw-SQL Registration writes and ignores reads", () => {
    expect(REGISTRATION_WRITE.test("await tx.registration.updateMany({ where, data })")).toBe(true);
    expect(REGISTRATION_WRITE.test("prisma.registration.update({")).toBe(true);
    expect(REGISTRATION_WRITE.test("tx.registration\n  .create({ data })")).toBe(true);
    expect(REGISTRATION_WRITE.test('UPDATE "Registration" SET status = ${s}')).toBe(true);
    expect(REGISTRATION_WRITE.test('INSERT INTO "Registration" (id) VALUES (${id})')).toBe(true);
    expect(REGISTRATION_WRITE.test("tx.registration.findUnique({ where })")).toBe(false);
    expect(REGISTRATION_WRITE.test("prisma.registration.count({ where })")).toBe(false);
    expect(REGISTRATION_WRITE.test('SELECT id FROM "Registration" WHERE id = ${id} FOR UPDATE')).toBe(false);
  });
});
