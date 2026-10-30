// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Ticket 74: the migration may only ADD nullable columns to "Campaign", so it
 * is safe on a populated table and the legacy free-text "location" survives.
 * Read as text because the CI `migrations` job applies it to an empty
 * database, which cannot show what it does to existing rows.
 */
const SQL = readFileSync(
  'prisma/migrations/20261031000000_campaign_location_beneficiaries/migration.sql',
  'utf8',
)
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('campaign_location_beneficiaries migration', () => {
  it('adds the four columns, all nullable and without a default', () => {
    for (const column of [
      '"province" TEXT',
      '"regency" TEXT',
      '"beneficiaryDescription" TEXT',
      '"beneficiaryCount" INTEGER',
    ]) {
      expect(SQL).toContain(`ADD COLUMN ${column}`);
    }
    expect(SQL).not.toMatch(/NOT NULL/i);
    expect(SQL).not.toMatch(/DEFAULT/i);
  });

  it('only alters "Campaign" and never drops or rewrites anything', () => {
    expect(SQL).not.toMatch(/\bDROP\b|\bUPDATE\b|\bDELETE\b|\bRENAME\b|\bTRUNCATE\b/i);
    expect(SQL).not.toMatch(/"location"/);
    const statements = SQL.split(';').map((s) => s.trim()).filter(Boolean);
    for (const statement of statements) expect(statement).toMatch(/^ALTER TABLE "Campaign"/);
  });

  it('keeps a given beneficiary count positive', () => {
    expect(SQL).toContain('CHECK ("beneficiaryCount" IS NULL OR "beneficiaryCount" > 0)');
  });
});
