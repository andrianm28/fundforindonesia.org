import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The Campaign and Volunteer Trip row locks have exactly one owner: the
 * subject guard (src/lib/subject-guard.ts). It takes the lock, then reads
 * the row, and it is where the lock order (subject before Payment) lives.
 * A second copy of the lock SQL elsewhere could read before it locks, or
 * lock in the other order, and nothing would notice.
 *
 * Recognises a row lock as `FROM "Campaign"` or `FROM "VolunteerTrip"`
 * followed, within the same statement, by a locking clause. Raw SQL built
 * some other way (string concatenation, another table alias) is outside
 * what it can see.
 *
 * The allowlist is a literal. Adding a file to it is a deliberate decision
 * that a reviewer sees in the diff.
 */
const ALLOWED_LOCKERS = ["src/lib/subject-guard.ts"];

const SUBJECT_LOCK =
  /FROM\s+"(Campaign|VolunteerTrip)"[^`;]*?\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/;

/**
 * The Batch and Registration row locks belong to the Volunteer Trip module
 * (src/lib/volunteer/trip.ts), which documents the one lock order: Trip →
 * Batch → Registration → Payment.
 */
const ALLOWED_BATCH_OR_REGISTRATION_LOCKERS = ["src/lib/volunteer/trip.ts"];

const BATCH_OR_REGISTRATION_LOCK =
  /FROM\s+"(VolunteerBatch|Registration)"[^`;]*?\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/;

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

describe("Campaign and Volunteer Trip row locks have one owner", () => {
  it("no file but the subject guard locks a Campaign or VolunteerTrip row", () => {
    const lockers = appFiles().filter((file) => SUBJECT_LOCK.test(readFileSync(file, "utf8")));

    expect(lockers).toEqual(ALLOWED_LOCKERS);
  });

  it("only the Volunteer Trip module locks a Batch or Registration row", () => {
    const lockers = appFiles()
      .filter((file) => BATCH_OR_REGISTRATION_LOCK.test(readFileSync(file, "utf8")))
      .sort();

    expect(lockers).toEqual([...ALLOWED_BATCH_OR_REGISTRATION_LOCKERS].sort());
  });

  it("recognises Batch and Registration lock SQL and ignores the subject tables", () => {
    expect(BATCH_OR_REGISTRATION_LOCK.test('SELECT id FROM "VolunteerBatch" WHERE id = ${id} FOR UPDATE')).toBe(true);
    expect(
      BATCH_OR_REGISTRATION_LOCK.test(
        'SELECT id, status FROM "Registration"\n  WHERE "batchId" = ${id} AND status IN (\'HOLD\')\n  ORDER BY id\n  FOR UPDATE'
      )
    ).toBe(true);
    expect(BATCH_OR_REGISTRATION_LOCK.test('SELECT id FROM "VolunteerTrip" WHERE id = ${id} FOR UPDATE')).toBe(false);
    expect(BATCH_OR_REGISTRATION_LOCK.test('SELECT id FROM "Registration" WHERE id = ${id}')).toBe(false);
  });

  // Guards the guard: if the pattern silently stopped matching, the test
  // above would fail on the allowlist rather than pass vacuously, but these
  // pin which spellings it recognises and which it leaves alone.
  it("recognises both tables' lock SQL and ignores other tables' locks", () => {
    expect(SUBJECT_LOCK.test('SELECT id FROM "Campaign" WHERE id = ${id} FOR UPDATE')).toBe(true);
    expect(SUBJECT_LOCK.test('SELECT id FROM "VolunteerTrip" WHERE id = ${id} FOR UPDATE')).toBe(true);
    expect(SUBJECT_LOCK.test('SELECT * FROM "Campaign"\n  WHERE id = ${id}\n  FOR NO KEY UPDATE')).toBe(true);
    expect(SUBJECT_LOCK.test('SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE')).toBe(false);
    expect(SUBJECT_LOCK.test('SELECT id FROM "VolunteerBatch" WHERE id = ${id} FOR UPDATE')).toBe(false);
    expect(SUBJECT_LOCK.test('SELECT id FROM "Campaign" WHERE id = ${id}')).toBe(false);
  });
});
