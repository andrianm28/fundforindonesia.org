// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The seeded document checklist behind hibah (csr-and-hibah 11, PRD FFI-08b).
 *
 * `hibah` ships with wakaf's documents and nothing of its own, because that is
 * what FFI-08b decides and the per-Kind mechanism cannot invent a sharia answer
 * the Platform has not got: ADR 0013 copies wakaf's treatment as a **stated
 * placeholder** until it is reviewed against the provisions that apply. The copy
 * is deliberate and temporary, not a settled rule, so what is pinned here is
 * the *shape* — hibah carries its own rows, one per wakaf document, so the two
 * lists can be diverged from the panel later without touching wakaf's rows —
 * and the placeholder is named as such wherever the labels are read.
 *
 * The seed itself lives in SQL, which no unit test executes: CI's `migrations`
 * job proves both statements apply to an empty Postgres. This reads them so a
 * later edit that folds hibah back into wakaf's rows, drops a document, or
 * leaves the placeholder looking settled fails here first.
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

describe("hibah's seeded checklist (csr-and-hibah 11, FFI-08b, ADR 0013)", () => {
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
    // "Draf akad wakaf" and "lembaga nazhir" are hibah's too, verbatim: that is
    // the placeholder the owner decided on, and the sharia review is what will
    // replace it. The one row that names a Kind names its own, since a hibah
    // Campaign holds a hibah authorisation.
    //
    // Pinned as it stands, which is not quite what PRD §7.1's hibah row lists
    // ("lembaga penerima" and the authorisation, no akad). Left as the owner
    // decided rather than reconciled here: whether a hibah Campaign needs a
    // wakaf akad draft is a question for the sharia review, and this test is
    // where its answer will land as a visible change.
    const withoutOwnKindName = (label: string) => label.replace(/^Kind Authorisation .*$/, "Kind Authorisation");
    const shape = (rows: SeededRow[]) => rows.map((row) => [withoutOwnKindName(row.label), row.required, row.active]);

    expect(shape(ofKind("HIBAH"))).toEqual(shape(ofKind("WAKAF")));
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
