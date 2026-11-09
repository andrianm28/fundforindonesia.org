// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The migration behind the Fundraiser's verification data (PKS pemenuhan 08,
 * pasal 3.2). The seed lives in SQL, which no unit test executes; CI's
 * `migrations` job proves it applies and leaves schema.prisma unchanged. This
 * reads the statements so a later edit that makes the seed overwrite an Admin's
 * edits, drops a document, or stores the phone in plaintext fails here first.
 */

const MIGRATION_DIR = "prisma/migrations";

function migrationSql(suffix: string): string {
  const match = readdirSync(MIGRATION_DIR).filter((d) => d.endsWith(suffix));
  expect(match).toHaveLength(1);
  return readFileSync(join(MIGRATION_DIR, match[0], "migration.sql"), "utf8");
}

const SQL = migrationSql("_data_verifikasi_penggalang");

describe("the verification data migration", () => {
  it("seeds the five checklist items as 'Semua' rows that need a document, idempotently", () => {
    for (const id of [
      "foto-diri-memegang-ktp",
      "bukti-alamat",
      "bukti-hubungan-penerima-manfaat",
      "surat-kuasa-lembaga",
      "dokumen-pendukung-program",
    ]) {
      expect(SQL).toContain(`'${id}'`);
    }
    // Stable ids and DO NOTHING: running it twice, or after an Admin has edited
    // a row, writes nothing.
    expect(SQL).toContain('ON CONFLICT ("id") DO NOTHING');
    // kind NULL ("Semua"), active, and a paper to upload.
    expect(SQL).toMatch(/true, NULL, true\s*\nFROM/);
  });

  it("makes only the surat kuasa optional", () => {
    expect(SQL).toMatch(/'surat-kuasa-lembaga', '[^']+', false, \d\)/);
    expect(SQL.match(/', true, \d\)/g)).toHaveLength(4);
  });

  it("continues the positions past what is there, so it never collides with a row already seeded", () => {
    expect(SQL).toContain('COALESCE(MAX(position), 0)');
  });

  it("seals the responsible person's phone as ciphertext columns, never a plaintext one", () => {
    expect(SQL).toContain('"responsiblePersonPhoneCiphertext" TEXT');
    expect(SQL).toContain('"responsiblePersonPhoneKeyId" TEXT');
    expect(SQL).not.toMatch(/"responsiblePersonPhone" /);
  });
});
