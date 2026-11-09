// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The migration behind the Campaign gallery, the truth statement and the
 * final rejection (PKS pemenuhan 09, pasal 3.3-3.4). Read as text because the
 * CI `migrations` job applies it to an empty database, which cannot show what
 * it does to existing rows; it proves the SQL applies and leaves schema.prisma
 * unchanged. This pins what must stay true of it.
 */
const MIGRATION_DIR = 'prisma/migrations';

function migrationSql(suffix: string): string {
  const match = readdirSync(MIGRATION_DIR).filter((d) => d.endsWith(suffix));
  expect(match).toHaveLength(1);
  return readFileSync(join(MIGRATION_DIR, match[0], 'migration.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

const SQL = migrationSql('_kampanye_galeri_pernyataan_penolakan_final');

describe('kampanye_galeri_pernyataan_penolakan_final migration', () => {
  it('only adds: it never drops, rewrites or deletes what is there', () => {
    expect(SQL).not.toMatch(/\bDROP\b|\bUPDATE\b|\bDELETE\b|\bRENAME\b|\bTRUNCATE\b/i);
  });

  it('gives every existing Campaign an empty gallery, and a rejection that is not final', () => {
    expect(SQL).toContain('"galleryImages" TEXT[] DEFAULT ARRAY[]::TEXT[]');
    expect(SQL).toContain('"rejectionFinal" BOOLEAN NOT NULL DEFAULT false');
  });

  it('marks existing status changes as not final', () => {
    expect(SQL).toContain('ALTER TABLE "CampaignStatusChange" ADD COLUMN     "final" BOOLEAN NOT NULL DEFAULT false');
  });

  it('leaves the truth statement time empty on requests that predate it', () => {
    expect(SQL).toMatch(/"truthStatementAcceptedAt" TIMESTAMP\(3\);/);
  });

  it('caps the gallery at six in the database too, so a second writer cannot exceed it', () => {
    expect(SQL).toContain('CHECK (cardinality("galleryImages") <= 6)');
  });
});
