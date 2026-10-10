// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as client from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';

/**
 * The retired User columns and the Role enum are gone (retire-role-hierarchy
 * 03). The by-name guard over application code stays in
 * user-role-readers.test.ts; this replaces the typed guard and canary that
 * kept the columns unnamed while they still existed.
 */
describe('the dropped User role columns', () => {
  it('are no longer User fields', () => {
    const fields = Object.keys(Prisma.UserScalarFieldEnum);
    for (const retired of ['role', 'isVerified', 'verificationType']) expect(fields).not.toContain(retired);
  });

  it('left no Role enum behind', () => {
    expect(client).not.toHaveProperty('Role');
  });

  it('are dropped, with the enum, by the migration that names them', () => {
    const dir = 'prisma/migrations';
    const dropping = readdirSync(dir)
      .filter((name) => /^\d/.test(name))
      .filter((name) => /ALTER TABLE "User"[^;]*DROP COLUMN "role"/.test(readFileSync(`${dir}/${name}/migration.sql`, 'utf8')));
    expect(dropping).toHaveLength(1);
    const sql = readFileSync(`${dir}/${dropping[0]}/migration.sql`, 'utf8');
    expect(sql).toContain('DROP COLUMN "isVerified"');
    expect(sql).toContain('DROP COLUMN "verificationType"');
    expect(sql).toContain('DROP TYPE "Role"');
  });
});
