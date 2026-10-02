// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * prd-compliance 23: confirming an email is a transaction, against a REAL
 * Postgres, because the guarantees are row-level (`updateMany ... usedAt: null`
 * and the rollback of the token spend) that a JS mock would only mirror:
 *   - one link opened twice at once confirms exactly once;
 *   - `emailVerifiedAt` is not written, and the token not spent, when any step
 *     of the confirmation fails.
 * Same setup as volunteer-registration-concurrency.test.ts: a throwaway
 * database migrated by replaying every migration, and a visible skip when
 * TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const NOW = new Date('2026-10-02T10:00:00Z');

// `@/lib/prisma` is the app's singleton; point it at the throwaway database.
const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return holder.client;
  },
}));
vi.mock('@/lib/mail', () => ({ sendReportingFailure: vi.fn() }));

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Email confirmation -- against real Postgres (prd-compliance 23)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[email verification concurrency] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `email_verification_${process.pid}`;
  let prisma: PrismaClient;
  let confirmEmailVerification: typeof import('@/lib/email-verification').confirmEmailVerification;

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
      const dirs = readdirSync(MIGRATIONS_DIR)
        .filter((d) => !d.startsWith('migration_lock'))
        .sort();
      for (const dir of dirs) await migrator.query(readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
    } finally {
      await migrator.end();
    }

    const adapter = new PrismaPg({ connectionString: url });
    const { PrismaClient: RealPrismaClient } = await import('@/generated/prisma/client');
    prisma = new RealPrismaClient({ adapter });
    holder.client = prisma;
    ({ confirmEmailVerification } = await import('@/lib/email-verification'));
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  let counter = 0;

  /** A fresh unverified User and a live token for its current address. */
  async function makeUserWithToken(tokenEmailHmac?: string) {
    const n = counter++;
    const id = `u-${process.pid}-${n}`;
    const emailHmac = `${id}-hmac`;
    await prisma.user.create({
      data: { id, name: 'Test', emailHmac, emailHmacKeyId: 'k', emailCiphertext: `${id}-c`, emailKeyId: 'k' },
    });
    const token = randomBytes(32).toString('base64url');
    const row = await prisma.emailVerificationToken.create({
      data: {
        userId: id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        emailHmac: tokenEmailHmac ?? emailHmac,
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    });
    return { id, token, tokenId: row.id };
  }

  const verifiedAt = async (id: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id }, select: { emailVerifiedAt: true } })).emailVerifiedAt;
  const usedAt = async (tokenId: string) =>
    (await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id: tokenId }, select: { usedAt: true } })).usedAt;

  it('confirms exactly once when one link is opened several times at once', async () => {
    const { id, token, tokenId } = await makeUserWithToken();

    const results = await Promise.all(Array.from({ length: 8 }, () => confirmEmailVerification(token, NOW)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(7);
    expect(await verifiedAt(id)).toEqual(NOW);
    expect(await usedAt(tokenId)).toEqual(NOW);
  });

  it('writes nothing, and leaves the token unspent, when the address changed since issue', async () => {
    const { id, token, tokenId } = await makeUserWithToken('hmac-of-an-older-address');

    expect(await confirmEmailVerification(token, NOW)).toEqual({ ok: false });

    expect(await verifiedAt(id)).toBeNull();
    expect(await usedAt(tokenId)).toBeNull();
  });

  it('rolls the token spend back when the verification write itself fails', async () => {
    const { id, token, tokenId } = await makeUserWithToken();
    const real = prisma;
    holder.client = real.$extends({
      query: {
        user: {
          updateMany() {
            return Promise.reject(new Error('simulated failure after the token was spent'));
          },
        },
      },
    });
    try {
      await expect(confirmEmailVerification(token, NOW)).rejects.toThrow('simulated failure');
    } finally {
      holder.client = real;
    }

    expect(await verifiedAt(id)).toBeNull();
    expect(await usedAt(tokenId)).toBeNull();
    // Nothing was burned: the same link still works afterwards.
    expect(await confirmEmailVerification(token, NOW)).toMatchObject({ ok: true });
  });
});
