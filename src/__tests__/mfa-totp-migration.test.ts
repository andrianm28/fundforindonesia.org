// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * pks-pemenuhan/03: the MFA migration (UserMfa, MfaBackupCode, MfaAuditEntry),
 * executed against a database that already holds Users and an Admin.
 *
 * It only adds tables, so what must be shown on a populated database is that
 * existing accounts are untouched and nobody is born enrolled, and that the
 * foreign keys behave: a User's factor goes with the User, but an audit entry
 * keeps its actor from being deleted (docs/agents/verification.md: a
 * migration's behaviour is a property of a database, so it is tested against
 * one). Needs TEST_DATABASE_URL; without it every test is skipped and says so.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const THIS_MIGRATION = '20261109090000_mfa_totp';

const allDirs = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('MFA migration against a populated database (pks-pemenuhan/03)', () => {
  if (!DATABASE_URL) {
    console.warn('[mfa migration] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `mfa_totp_${process.pid}`;
  let db: Client;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();

    db = new Client({ connectionString: databaseUrlFor(databaseName) });
    await db.connect();

    expect(allDirs()).toContain(THIS_MIGRATION);
    for (const dir of allDirs().filter((d) => d < THIS_MIGRATION)) await db.query(sqlOf(dir));

    await db.query(
      `INSERT INTO "User" (id, name, "emailHmac", "emailHmacKeyId", "emailCiphertext", "emailKeyId", "updatedAt")
       VALUES ('u-admin', 'Admin', 'h1', 'k', 'c1', 'k', now()), ('u-donor', 'Donor', 'h2', 'k', 'c2', 'k', now())`,
    );
    await db.query(`INSERT INTO "UserAssignment" ("userId", assignment) VALUES ('u-admin', 'ADMIN')`);

    await db.query(sqlOf(THIS_MIGRATION));
  }, 180_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await db?.end();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  it('leaves existing Users and assignments as they were, and enrols nobody', async () => {
    const users = await db.query(`SELECT id FROM "User" ORDER BY id`);
    expect(users.rows).toEqual([{ id: 'u-admin' }, { id: 'u-donor' }]);
    const assignments = await db.query(`SELECT "userId", assignment FROM "UserAssignment"`);
    expect(assignments.rows).toEqual([{ userId: 'u-admin', assignment: 'ADMIN' }]);
    for (const table of ['UserMfa', 'MfaBackupCode', 'MfaAuditEntry']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect(rows).toEqual([{ n: 0 }]);
    }
  });

  it('starts a factor not enabled, at step 0', async () => {
    await db.query(
      `INSERT INTO "UserMfa" ("userId", "secretCiphertext", "secretKeyId", "updatedAt") VALUES ('u-donor', 'x', 'k', now())`,
    );
    const { rows } = await db.query(`SELECT "enabledAt", "lastUsedStep" FROM "UserMfa" WHERE "userId" = 'u-donor'`);
    expect(rows).toEqual([{ enabledAt: null, lastUsedStep: 0 }]);
  });

  it('allows one factor per User', async () => {
    await expect(
      db.query(`INSERT INTO "UserMfa" ("userId", "secretCiphertext", "secretKeyId", "updatedAt") VALUES ('u-donor', 'y', 'k', now())`),
    ).rejects.toThrow(/duplicate key/);
  });

  it("removes a User's factor, backup codes and audit rows with the User, but protects an actor", async () => {
    await db.query(`INSERT INTO "MfaBackupCode" (id, "userId", "codeHash") VALUES ('b1', 'u-donor', 'h')`);
    await db.query(
      `INSERT INTO "MfaAuditEntry" (id, "userId", "actedById", action) VALUES ('a1', 'u-donor', 'u-admin', 'RESET')`,
    );
    await expect(db.query(`DELETE FROM "User" WHERE id = 'u-admin'`)).rejects.toThrow(/foreign key|violates/);
    await db.query(`DELETE FROM "User" WHERE id = 'u-donor'`);
    for (const table of ['UserMfa', 'MfaBackupCode', 'MfaAuditEntry']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect(rows).toEqual([{ n: 0 }]);
    }
  });
});
