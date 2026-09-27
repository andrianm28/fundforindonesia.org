// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The document checklist behind hibah (csr-and-hibah 11, PRD FFI-08b).
 *
 * `hibah` shipped carrying wakaf's documents and nothing of its own, because
 * that is what FFI-08b decides and the per-Kind mechanism cannot invent a sharia
 * answer the Platform has not got: ADR 0013 copies wakaf's treatment as a
 * **stated placeholder** until it is reviewed against the provisions that apply.
 * One of those three documents has since been retired on the owner's decision
 * of 2026-09-27: `Draf akad wakaf` is a wakaf document, and PRD §4 says plainly
 * that a hibah Campaign has no Akad Wakaf at all. So the copy was a placeholder
 * that overreached, and hibah now asks for the two documents PRD §7.1 gives it.
 *
 * The seed lives in SQL, which no unit test executes: CI's `migrations` job
 * proves every statement applies to an empty Postgres. This reads them — the
 * seed as it was written, plus the corrections layered over it in the order a
 * database would apply them — and pins what a submission is actually snapshotted
 * from. A later edit that folds hibah back into wakaf's rows, retires something
 * else, retires it unconditionally, or leaves the placeholder looking settled
 * fails here first.
 */

const MIGRATION_DIR = "prisma/migrations";

function migrationSql(suffix: string): string {
  const match = readdirSync(MIGRATION_DIR).filter((d) => d.endsWith(suffix));
  expect(match).toHaveLength(1);
  return readFileSync(join(MIGRATION_DIR, match[0], "migration.sql"), "utf8");
}

/** One seeded checklist row: `('id', 'label', required, active, 'KIND', ord)`. */
type SeededRow = { id: string; label: string; required: boolean; active: boolean; kind: string };

function seededRows(sql: string): SeededRow[] {
  const rows: SeededRow[] = [];
  for (const match of sql.matchAll(/\(\s*'([\w-]+)',\s*'((?:[^']|'')*)',\s*(true|false),\s*(true|false),\s*'([A-Z]+)',\s*\d+\s*\)/g)) {
    rows.push({ id: match[1], label: match[2], required: match[3] === "true", active: match[4] === "true", kind: match[5] });
  }
  return rows;
}

const SEED = seededRows(migrationSql("_per_kind_and_change_requests"));
const HIBAH_CORRECTION = migrationSql("_hibah_kind_authorisation_label");
const RETIREMENT_SQL = migrationSql("_hibah_without_akad_wakaf");

/** One condition of a `WHERE` clause: `"column" = 'value'` or `= true`. */
type Condition = { column: string; value: string | boolean };

/**
 * The conditions of the statement that retires the hibah akad row, read off the
 * migration. Parsed rather than hard-coded so a condition that is dropped from
 * the SQL — the one that makes it an `hibah` row, the one that makes it the
 * seed's wording — is a failing test here and not a wider statement in a
 * database.
 */
const RETIREMENT: Condition[] = [
  ...(RETIREMENT_SQL.match(/WHERE([\s\S]*?);/) ?? ["", ""])[1].matchAll(
    /"(\w+)"\s*=\s*(?:'([^']*)'(?:::"Kind")?|(true|false))/g,
  ),
].map((match) =>
  match[2] !== undefined
    ? { column: match[1], value: match[2] }
    : { column: match[1], value: match[3] === "true" },
);

const isRetired = (row: SeededRow) => RETIREMENT.every((c) => row[c.column as keyof SeededRow] === c.value);

/** The rows a submission of `kind` snapshots: seeded, minus the retired ones. */
const activeOf = (kind: string) => SEED.filter((row) => row.kind === kind && !isRetired(row));

describe("hibah's checklist: the seed and the corrections over it (csr-and-hibah 11, FFI-08b, ADR 0013)", () => {
  const ofKind = (kind: string) => SEED.filter((row) => row.kind === kind);

  it("carries its own row for every wakaf document, none of them shared", () => {
    // Separate rows per Kind is the whole point: a shared row would be one
    // edit away from changing what wakaf's Verifier sees, which is exactly
    // what this ticket requires the Admin to be able to avoid.
    const wakaf = ofKind("WAKAF");
    const hibah = ofKind("HIBAH");

    expect(wakaf.length).toBeGreaterThan(0);
    expect(hibah).toHaveLength(wakaf.length);
    expect(hibah.map((row) => row.id)).toEqual(wakaf.map((row) => row.id.replace(/^wakaf-/, "hibah-")));
    expect(hibah.some((row) => wakaf.some((w) => w.id === row.id))).toBe(false);
  });

  it("starts out with the same documents, in the same order, as wakaf's", () => {
    // About the seed, which is history: Prisma has applied it, so it is read as
    // it was written. "Draf akad wakaf" and "lembaga nazhir" were hibah's too,
    // verbatim — the placeholder FFI-08b decided on, which the sharia review was
    // always going to have to replace. The one row that names a Kind names its
    // own, since a hibah Campaign holds a hibah authorisation.
    //
    // What the seed no longer decides is pinned below, against the migrations
    // that came after it: the akad is retired, and the "nazhir" wording is the
    // half of the question still open.
    const withoutOwnKindName = (label: string) => label.replace(/^Kind Authorisation .*$/, "Kind Authorisation");
    const shape = (rows: SeededRow[]) => rows.map((row) => [withoutOwnKindName(row.label), row.required, row.active]);

    expect(shape(ofKind("HIBAH"))).toEqual(shape(ofKind("WAKAF")));
  });

  it("asks hibah for the two documents PRD §7.1 gives it, and no akad", () => {
    // §7.1's hibah row: the receiving-entity document and Kind Authorisation
    // `hibah`. The akad is gone because PRD §4 says a hibah Campaign has no Akad
    // Wakaf and no ikrar at all ("dokumen dan alur akad khusus untuk hibah
    // menyusul bila ditinjau ulang"), so asking its Verifier for a wakaf akad
    // draft named a document the Campaign being checked cannot produce.
    expect(activeOf("HIBAH").map((row) => row.id)).toEqual(["hibah-lembaga-nazhir", "hibah-kind-authorisation"]);
    expect(activeOf("HIBAH").map((row) => row.label)).not.toContain("Draf akad wakaf");
  });

  it("leaves wakaf's three documents, its akad among them, as the seed wrote them", () => {
    // The Akad Wakaf is a real document of a real wakaf flow, so this is not
    // "hibah = wakaf minus wakaf": wakaf's rows are not in the statement's
    // scope at all, and are named here so a widening of it shows up.
    const wakaf = ofKind("WAKAF");
    expect(wakaf.map((row) => row.id)).toEqual(["wakaf-lembaga-nazhir", "wakaf-draf-akad", "wakaf-kind-authorisation"]);
    expect(wakaf.some((row) => isRetired(row))).toBe(false);
  });

  it("retires the row only while it still reads as the seed left it", () => {
    // Every part of the seed's row is in the condition: its id, its Kind, the
    // label the seed wrote, and its being active. An Admin who has reworded it,
    // moved it to another Kind, or already retired it in the panel keeps their
    // edit — the checklist's history is the Admin's, not this migration's.
    //
    // `required` is deliberately not a condition, and that is the shape to keep:
    // an Admin having made this document optional does not bear on the decision,
    // since a hibah Campaign has no akad to make optional in the first place.
    expect(RETIREMENT).toEqual([
      { column: "id", value: "hibah-draf-akad" },
      { column: "kind", value: "HIBAH" },
      { column: "label", value: "Draf akad wakaf" },
      { column: "active", value: true },
    ]);
  });

  it("deactivates rather than deletes, so the row and its audit history stay", () => {
    // The checklist is append-only by design ("nothing is ever deleted", and an
    // audit entry references its item with ON DELETE RESTRICT), so a DELETE here
    // would fail on a row that has history and take that history with it
    // otherwise. Deactivating also leaves every Verification Request already
    // judged against a snapshot carrying this item alone: only a submission made
    // from here on is asked for two documents instead of three.
    const statement = RETIREMENT_SQL.match(/UPDATE[\s\S]*;/)?.[0] ?? "";
    expect(RETIREMENT_SQL.match(/UPDATE[\s\S]*?;/g)).toHaveLength(1);
    expect(RETIREMENT_SQL).not.toMatch(/DELETE\s+FROM/i);
    // The label, the position and the required flag are the seed's, and stay:
    // only `active` changes. Read from the SET clause alone, since the label is
    // named again in the WHERE as the condition that keeps the row safe to touch.
    const assignments = statement.match(/SET([\s\S]*?)WHERE/)?.[1] ?? "";
    expect(assignments.trim()).toBe('"active" = false');
    expect(assignments).not.toMatch(/"label"|"position"|"required"/);
  });

  it("still calls the two remaining documents a placeholder, not a settled list", () => {
    // What the retirement settles is that there is no akad. It does not settle
    // whether these two are the right two: "lembaga nazhir" against §7.1's
    // "lembaga penerima" is the other half of the same question, and it belongs
    // to the sharia review (ADR 0013, PRD §12, pasal 14) as much as the removed
    // akad did. Saying so where the SQL is read is what makes that review's
    // answer a deliberate change rather than a regression to be explained.
    expect(RETIREMENT_SQL).toMatch(/ADR 0013/);
    expect(RETIREMENT_SQL).toMatch(/pasal 14/);
    expect(RETIREMENT_SQL).toMatch(/syariah|sharia/i);
    expect(RETIREMENT_SQL).toMatch(/does not settle/i);
  });

  it("gives every hibah row a hibah id and Kind, so nothing leaks across the two lists", () => {
    // The seed's id and its kind are written by hand, side by side, so a row
    // copied with the wrong kind left in place is the easy slip: hibah's
    // Verifier would then be shown a document scoped to wakaf, or wakaf's
    // would gain one of hibah's. kind NULL is the "Semua" row, snapshotted by
    // every Kind, which is not what any of these rows is.
    const rows = ofKind("HIBAH");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.id.startsWith("hibah-"))).toEqual(rows.map(() => true));
    expect(ofKind("WAKAF").map((row) => row.id.startsWith("wakaf-"))).toEqual(ofKind("WAKAF").map(() => true));
  });

  it("names hibah's own Kind Authorisation, which is the one a hibah Campaign can hold", () => {
    // A hibah Campaign is refused unless its Collecting Entity holds a HIBAH
    // authorisation (ADR 0013), so asking its Verifier for a *wakaf* one is
    // unsatisfiable by the right document.
    expect(ofKind("WAKAF").map((row) => row.label)).toContain("Kind Authorisation wakaf");
    expect(HIBAH_CORRECTION).toContain("'hibah-kind-authorisation'");
    expect(HIBAH_CORRECTION).toContain("'Kind Authorisation hibah'");
    expect(HIBAH_CORRECTION).toMatch(/WHERE\s+"id"\s*=\s*'hibah-kind-authorisation'/);
  });

  it("says in the correction that the documents themselves are still a placeholder", () => {
    expect(HIBAH_CORRECTION).toMatch(/ADR 0013/);
    expect(HIBAH_CORRECTION).toMatch(/syariah|sharia/i);
  });

  it("corrects only the label, and only while the row still reads as the seed left it", () => {
    // Positions, the required flag and every other row are untouched, and a
    // label an Admin has already reworded in the panel is left alone: the
    // checklist's own history is the Admin's, not this migration's.
    const updates = HIBAH_CORRECTION.match(/UPDATE[\s\S]*?;/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('SET "label"');
    expect(updates[0]).not.toMatch(/SET[^;]*"position"/);
    expect(updates[0]).not.toMatch(/SET[^;]*"required"/);
    expect(updates[0]).toMatch(/WHERE[\s\S]*"id"\s*=\s*'hibah-kind-authorisation'[\s\S]*"label"\s*=/);
  });
});
