// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Ticket csr-06b: the public-endpoint rate limit against a REAL Postgres. The
 * guarantee is atomicity across callers -- N simultaneous requests from one
 * source never get more than `limit` through -- and that is a property of the
 * database's upsert, which a mock would only mirror. Same setup as
 * volunteer-registration-concurrency.test.ts; a visible skip when
 * TEST_DATABASE_URL is unset.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('rate limit -- against real Postgres (csr-06b)', () => {
  if (!DATABASE_URL) {
    console.warn('[rate limit] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }
  const databaseName = `rate_limit_${process.pid}`;
  let prisma: PrismaClient;
  let consumeRateLimit: typeof import('@/lib/rate-limit').consumeRateLimit;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await admin.end();
    const url = databaseUrlFor(databaseName);
    const migrator = new Client({ connectionString: url });
    await migrator.connect();
    try {
      const dirs = readdirSync(MIGRATIONS_DIR).filter((d) => !d.startsWith('migration_lock')).sort();
      for (const dir of dirs) await migrator.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
    } finally {
      await migrator.end();
    }
    const { PrismaClient: RealPrismaClient } = await import('@/generated/prisma/client');
    prisma = new RealPrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    ({ consumeRateLimit } = await import('@/lib/rate-limit'));
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  const base = { scope: 'test', windowSeconds: 3600, now: new Date('2026-10-02T10:30:00Z') };

  it('lets exactly `limit` of 40 simultaneous requests through', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => consumeRateLimit(prisma, { ...base, subject: 'race', limit: 7 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(7);
    expect(results.filter((r) => !r.allowed)).toHaveLength(33);
  }, 60_000);

  it('counts each subject separately and starts over in the next window', async () => {
    for (let i = 0; i < 2; i++) await consumeRateLimit(prisma, { ...base, subject: 'a', limit: 2 });
    expect((await consumeRateLimit(prisma, { ...base, subject: 'a', limit: 2 })).allowed).toBe(false);
    expect((await consumeRateLimit(prisma, { ...base, subject: 'b', limit: 2 })).allowed).toBe(true);
    const later = new Date(base.now.getTime() + 3600_000);
    expect((await consumeRateLimit(prisma, { ...base, now: later, subject: 'a', limit: 2 })).allowed).toBe(true);
  });

  it('stores only a keyed hash of the subject, and drops windows long past', async () => {
    const rows = await prisma.$queryRawUnsafe<{ subjectHash: string }[]>(`SELECT "subjectHash" FROM "RateLimitBucket"`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.subjectHash).toMatch(/^[0-9a-f]{64}$/);
    const far = new Date(base.now.getTime() + 3 * 24 * 3600_000);
    await consumeRateLimit(prisma, { ...base, now: far, subject: 'fresh', limit: 2 });
    const old = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "RateLimitBucket" WHERE "windowStart" < $1`,
      new Date(far.getTime() - 24 * 3600_000),
    );
    expect(old[0].n).toBe(0);
  });
});
