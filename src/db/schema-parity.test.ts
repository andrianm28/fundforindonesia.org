// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { getTableConfig, isPgEnum, PgTable } from 'drizzle-orm/pg-core';
import { eq, is } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';

/**
 * src/db/schema.ts against the database prisma/migrations builds (ADR 0029,
 * drizzle-migration ticket 01). Prisma owns the migrations until ticket 09, so
 * the Drizzle schema is a description that can drift: a migration that adds a
 * column, an enum value, a check or an index without a matching edit here
 * turns this test red. Same setup as the other real-DB tests: a throwaway
 * database migrated by replaying every migration, and a visible skip when
 * TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

const exported: unknown[] = Object.values(schema);
const tables = exported.filter((v): v is PgTable => is(v, PgTable));
const enums = exported.filter(isPgEnum);

/** Postgres' format_type() and Drizzle's getSQLType() spell some types differently. */
function normaliseType(t: string): string {
  return t
    .replace(/^timestamp\((\d)\) without time zone/, 'timestamp($1)')
    .replace(/^timestamp without time zone/, 'timestamp')
    .replace(/^timestamp \((\d)\)/, 'timestamp($1)')
    .replace(/^character varying/, 'varchar')
    .replace(/^double precision/, 'double precision')
    .replace(/^"?([A-Za-z]+)"?(\[\])?$/, (_m, name: string, arr?: string) => `${name}${arr ?? ''}`);
}

describe.skipIf(!DATABASE_URL)('Drizzle schema matches the migrated database (ADR 0029)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[drizzle schema parity] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `drizzle_parity_${process.pid}`;
  let client: Client;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();

    client = new Client({ connectionString: databaseUrlFor(databaseName) });
    await client.connect();
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) await client.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await client?.end();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  it('has exactly the same tables', async () => {
    const { rows } = await client.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`,
    );
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual(rows.map((r) => r.name).sort());
  });

  it('has the same columns, types and nullability in every table', async () => {
    const { rows } = await client.query<{ table: string; column: string; type: string; notnull: boolean }>(
      `SELECT c.relname AS table, a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
          AND c.relname <> '_prisma_migrations'`,
    );
    const db = rows.map((r) => `${r.table}.${r.column} ${normaliseType(r.type)}${r.notnull ? ' not null' : ''}`).sort();
    const drizzleColumns = tables
      .flatMap((t) => {
        const cfg = getTableConfig(t);
        return cfg.columns.map(
          (c) => `${cfg.name}.${c.name} ${normaliseType(c.getSQLType())}${c.notNull ? ' not null' : ''}`,
        );
      })
      .sort();
    expect(drizzleColumns).toEqual(db);
  });

  it('has every enum with the same values in the same order', async () => {
    const { rows } = await client.query<{ name: string; values: string[] }>(
      `SELECT t.typname::text AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' GROUP BY t.typname`,
    );
    const db = Object.fromEntries(rows.map((r) => [r.name, r.values]));
    const drizzleEnums = Object.fromEntries(enums.map((e) => [e.enumName, [...e.enumValues]]));
    expect(drizzleEnums).toEqual(db);
  });

  it('names every check, foreign key and index the database has', async () => {
    const { rows } = await client.query<{ name: string }>(
      `SELECT con.conname AS name FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE n.nspname = 'public' AND con.contype IN ('c', 'f') AND c.relname <> '_prisma_migrations'
       UNION ALL
       SELECT i.indexname FROM pg_indexes i
        WHERE i.schemaname = 'public' AND i.tablename <> '_prisma_migrations' AND i.indexname NOT LIKE '%_pkey'`,
    );
    const drizzleNames = tables
      .flatMap((t) => {
        const cfg = getTableConfig(t);
        return [
          ...cfg.checks.map((c) => c.name),
          ...cfg.foreignKeys.map((f) => f.getName()),
          ...cfg.indexes.map((i) => i.config.name!),
          ...cfg.uniqueConstraints.map((u) => u.getName()),
        ];
      })
      .sort();
    expect(drizzleNames).toEqual(rows.map((r) => r.name).sort());
  });

  it('keeps the ledger amount check, so a non-positive LedgerEntry is still refused', async () => {
    const cfg = getTableConfig(schema.ledgerEntry);
    expect(cfg.checks.map((c) => c.name)).toContain('LedgerEntry_amount_positive');
    const { rows } = await client.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'LedgerEntry_amount_positive'`,
    );
    expect(rows[0].def).toMatch(/amount > 0/);
  });

  it('reads through Drizzle the same row a plain SQL write stored, with timestamps as Date', async () => {
    const pool = new Pool({ connectionString: databaseUrlFor(databaseName) });
    try {
      const db = drizzle({ client: pool, schema });
      await pool.query(
        `INSERT INTO "User" (id, name, "emailHmac", "emailHmacKeyId", "emailCiphertext", "emailKeyId", "updatedAt")
         VALUES ('u-parity', 'Parity', 'h', 'k', 'c', 'k', now())`,
      );
      const [row] = await db.select().from(schema.user).where(eq(schema.user.id, 'u-parity'));
      expect(row.name).toBe('Parity');
      expect(row.createdAt).toBeInstanceOf(Date);
    } finally {
      await pool.end();
    }
  });
});
