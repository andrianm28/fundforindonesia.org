// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Prisma } from '@/generated/prisma/client';

/**
 * The legacy Campaign `status` string is gone (legacy-status-contract 03):
 * `lifecycleStatus` is the one status column. These replace the guard and the
 * canary that kept the column unnamed while it still existed.
 */
describe('the dropped legacy Campaign status column', () => {
  it('is no longer a Campaign field', () => {
    const fields = Object.keys(Prisma.CampaignScalarFieldEnum);
    expect(fields).not.toContain('status');
    expect(fields).toContain('lifecycleStatus');
  });

  it('is dropped, with its indexes, by the newest migration that names it', () => {
    const dir = 'prisma/migrations';
    const dropping = readdirSync(dir)
      .filter((name) => /^\d/.test(name))
      .filter((name) => /DROP COLUMN "status"/.test(readFileSync(`${dir}/${name}/migration.sql`, 'utf8')))
      .filter((name) => /ALTER TABLE "Campaign"/.test(readFileSync(`${dir}/${name}/migration.sql`, 'utf8')));
    expect(dropping).toHaveLength(1);
    const sql = readFileSync(`${dir}/${dropping[0]}/migration.sql`, 'utf8');
    expect(sql).toContain('DROP INDEX "Campaign_status_idx"');
    expect(sql).toContain('DROP INDEX "Campaign_isUrgent_status_idx"');
  });
});
