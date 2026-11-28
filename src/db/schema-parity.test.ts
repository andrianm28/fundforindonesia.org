// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';

/**
 * src/db/schema.ts against the database prisma/migrations builds (ADR 0029,
 * drizzle-migration ticket 01). Prisma owns the migrations until ticket 09, so
 * the Drizzle schema is a description that can drift. Two throwaway
 * databases are built side by side:
 *
 * - `prisma`: every migration in prisma/migrations replayed, as production;
 * - `drizzle`: the DDL `drizzle-kit generate` writes from src/db/schema.ts.
 *
 * Their catalogs are then compared object by object: columns (type,
 * nullability, default), enums (values in order), every constraint
 * (pg_get_constraintdef: checks, foreign keys with their actions, primary
 * keys, uniques) and every index (pg_get_indexdef: columns, method,
 * uniqueness, predicate). A migration without the matching edit here, or a
 * hand edit here that production does not have, turns this red.
 *
 * Known, deliberate difference: Drizzle cannot write NOT VALID, so the two
 * checks production added NOT VALID (LedgerEntry_amount_positive,
 * Campaign_beneficiaryCount_positive) are compared with that suffix removed;
 * the ledger test below proves the production one is still there.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const IGNORED_TABLES = `('_prisma_migrations', '__drizzle_migrations')`;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

type Catalog = {
  columns: string[];
  enums: Record<string, string[]>;
  constraints: Record<string, string>;
  indexes: Record<string, string>;
};

async function readCatalog(client: Client): Promise<Catalog> {
  const columns = await client.query<{ line: string }>(
    `SELECT c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
            || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
            || COALESCE(' default ' || pg_get_expr(d.adbin, d.adrelid), '') AS line
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
        AND c.relname NOT IN ${IGNORED_TABLES}`,
  );
  const enums = await client.query<{ name: string; values: string[] }>(
    `SELECT t.typname::text AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' GROUP BY t.typname`,
  );
  const constraints = await client.query<{ name: string; def: string }>(
    `SELECT c.relname || '.' || con.conname AS name, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname NOT IN ${IGNORED_TABLES}`,
  );
  const indexes = await client.query<{ name: string; def: string }>(
    `SELECT indexname AS name, indexdef AS def FROM pg_indexes
      WHERE schemaname = 'public' AND tablename NOT IN ${IGNORED_TABLES}`,
  );
  return {
    columns: columns.rows.map((r) => r.line).sort(),
    enums: Object.fromEntries(enums.rows.map((r) => [r.name, r.values])),
    constraints: Object.fromEntries(constraints.rows.map((r) => [r.name, r.def.replace(/ NOT VALID$/, '')])),
    indexes: Object.fromEntries(indexes.rows.map((r) => [r.name, r.def])),
  };
}

describe.skipIf(!DATABASE_URL)('Drizzle schema matches the migrated database (ADR 0029)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[drizzle schema parity] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const prismaDb = `drizzle_parity_prisma_${process.pid}`;
  const drizzleDb = `drizzle_parity_drizzle_${process.pid}`;
  let prismaSide: Client;
  let drizzleSide: Client;
  let fromMigrations: Catalog;
  let fromDrizzle: Catalog;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${prismaDb}"`);
    await admin.query(`CREATE DATABASE "${drizzleDb}"`);
    await admin.end();

    prismaSide = new Client({ connectionString: databaseUrlFor(prismaDb) });
    await prismaSide.connect();
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) await prismaSide.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));

    const out = mkdtempSync(join(tmpdir(), 'drizzle-parity-'));
    try {
      execFileSync(
        resolve('node_modules/.bin/drizzle-kit'),
        ['generate', '--dialect', 'postgresql', '--schema', 'src/db/schema.ts', '--out', out],
        { stdio: 'pipe' },
      );
      const [file] = readdirSync(out).filter((f) => f.endsWith('.sql'));
      drizzleSide = new Client({ connectionString: databaseUrlFor(drizzleDb) });
      await drizzleSide.connect();
      // drizzle-kit does not manage extensions (pg_trgm, for the trigram index);
      // they come from the migrations, so install the same set first.
      const { rows: extensions } = await prismaSide.query<{ name: string }>(
        `SELECT extname AS name FROM pg_extension WHERE extname <> 'plpgsql'`,
      );
      for (const { name } of extensions) await drizzleSide.query(`CREATE EXTENSION IF NOT EXISTS "${name}"`);
      for (const statement of readFileSync(join(out, file), 'utf8').split('--> statement-breakpoint')) {
        if (statement.trim()) await drizzleSide.query(statement);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }

    fromMigrations = await readCatalog(prismaSide);
    fromDrizzle = await readCatalog(drizzleSide);
  }, 180_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prismaSide?.end();
    await drizzleSide?.end();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${prismaDb}" WITH (FORCE)`);
    await admin.query(`DROP DATABASE IF EXISTS "${drizzleDb}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  it('has the same tables and columns, with the same types, nullability and defaults', () => {
    expect(fromDrizzle.columns).toEqual(fromMigrations.columns);
  });

  it('has every enum with the same values in the same order', () => {
    expect(fromDrizzle.enums).toEqual(fromMigrations.enums);
  });

  it('has the same checks, foreign keys (with their actions), primary keys and uniques', () => {
    expect(fromDrizzle.constraints).toEqual(fromMigrations.constraints);
  });

  it('has the same indexes: columns, method, uniqueness and predicate', () => {
    expect(fromDrizzle.indexes).toEqual(fromMigrations.indexes);
  });

  it('keeps the ledger amount check that production has', () => {
    expect(getTableConfig(schema.ledgerEntry).checks.map((c) => c.name)).toContain('LedgerEntry_amount_positive');
    expect(fromMigrations.constraints['LedgerEntry.LedgerEntry_amount_positive']).toBe('CHECK ((amount > 0))');
  });

  it('reads through Drizzle the row Prisma wrote, with the same values and Date timestamps', async () => {
    const pool = new Pool({ connectionString: databaseUrlFor(prismaDb) });
    const { PrismaClient } = await import('@/generated/prisma/client');
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      const written = await prisma.user.create({
        data: {
          id: 'u-parity',
          name: 'Parity',
          emailHmac: 'h',
          emailHmacKeyId: 'k',
          emailCiphertext: 'c',
          emailKeyId: 'k',
        },
      });
      const db = drizzle({ client: pool, schema });
      const [read] = await db.select().from(schema.user).where(eq(schema.user.id, 'u-parity'));
      expect(read.createdAt).toBeInstanceOf(Date);
      expect(read.createdAt.getTime()).toBe(written.createdAt.getTime());
      expect(read.name).toBe(written.name);
      expect(read.emailHmac).toBe(written.emailHmac);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });
});
