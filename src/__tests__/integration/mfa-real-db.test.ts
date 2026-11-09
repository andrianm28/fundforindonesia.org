// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { base32Decode, totpAt } from '@/lib/totp';

/**
 * The second factor against a REAL Postgres (pks-pemenuhan/03): enrolment,
 * the code check, one-time use of a code and of a backup code, the attempt
 * limit and the Admin reset. The replay and single-use guarantees are
 * conditional UPDATEs, so a mock would only restate them; same throwaway
 * database setup as tim-csr-real-db.test.ts, and a visible skip when
 * TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('MFA TOTP -- against real Postgres (pks-pemenuhan/03)', () => {
  if (!DATABASE_URL) {
    console.warn('[mfa] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  // Backup codes are bcrypt at the production cost (ten per enrolment); under
  // a loaded CPU that outgrows the 5s default.
  vi.setConfig({ testTimeout: 60_000 });

  const databaseName = `mfa_${process.pid}`;
  let prisma: PrismaClient;
  let mfa: typeof import('@/lib/mfa');

  const t0 = Date.UTC(2026, 10, 9, 12, 0, 0);
  const codeAt = (secret: string, ms: number) => totpAt(base32Decode(secret), ms);

  async function newUser(id: string) {
    await prisma.user.create({
      data: { id, name: id, emailHmac: `h-${id}`, emailHmacKeyId: 'k', emailCiphertext: `c-${id}`, emailKeyId: 'k' },
    });
  }

  async function enrol(userId: string, at = t0) {
    const begun = await mfa.beginEnrollment(prisma, { userId, account: `${userId}@example.id` });
    if (!begun.ok) throw new Error('begin failed');
    const confirmed = await mfa.confirmEnrollment(prisma, { userId, code: codeAt(begun.secret, at), now: at });
    if (!confirmed.ok) throw new Error(`confirm failed: ${confirmed.reason}`);
    return { secret: begun.secret, backupCodes: confirmed.backupCodes, enabledAt: confirmed.enabledAt };
  }

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    vi.stubEnv('FIELD_ENCRYPTION_KEY', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    vi.stubEnv('FIELD_ENCRYPTION_KEY_ID', 'enc-test-1');
    vi.stubEnv('FIELD_HMAC_KEY', 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=');
    vi.stubEnv('FIELD_HMAC_KEY_ID', 'hmac-test-1');

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
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    mfa = await import('@/lib/mfa');
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    vi.unstubAllEnvs();
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  describe('enrolment', () => {
    it('stores the secret sealed, never in the clear, and is not enrolled until a code confirms it', async () => {
      await newUser('enrol-1');
      const begun = await mfa.beginEnrollment(prisma, { userId: 'enrol-1', account: 'enrol-1@example.id' });
      expect(begun).toMatchObject({ ok: true });
      if (!begun.ok) return;
      expect(begun.uri).toContain(`secret=${begun.secret}`);

      const row = await prisma.userMfa.findUniqueOrThrow({ where: { userId: 'enrol-1' } });
      expect(row.enabledAt).toBeNull();
      expect(row.secretCiphertext).not.toContain(begun.secret);
      expect(row.secretKeyId).toBe('enc-test-1');
      expect(await mfa.getMfaStatus(prisma, 'enrol-1')).toMatchObject({ enrolled: false, pending: true });
    });

    it('refuses a wrong first code and enrols on a right one, issuing ten codes stored only as hashes', async () => {
      await newUser('enrol-2');
      const begun = await mfa.beginEnrollment(prisma, { userId: 'enrol-2', account: 'a@b.id' });
      if (!begun.ok) throw new Error('begin');
      const wrong = await mfa.confirmEnrollment(prisma, { userId: 'enrol-2', code: '000000', now: t0 });
      expect(wrong).toEqual({ ok: false, reason: 'invalid' });
      expect((await mfa.getMfaStatus(prisma, 'enrol-2')).enrolled).toBe(false);

      const good = await mfa.confirmEnrollment(prisma, { userId: 'enrol-2', code: codeAt(begun.secret, t0), now: t0 });
      expect(good.ok).toBe(true);
      if (!good.ok) return;
      expect(good.backupCodes).toHaveLength(10);
      expect(new Set(good.backupCodes).size).toBe(10);
      const stored = await prisma.mfaBackupCode.findMany({ where: { userId: 'enrol-2' } });
      expect(stored).toHaveLength(10);
      for (const row of stored) {
        expect(row.codeHash).toMatch(/^\$2[aby]\$/);
        expect(good.backupCodes).not.toContain(row.codeHash);
      }
      expect(await mfa.getMfaStatus(prisma, 'enrol-2')).toMatchObject({ enrolled: true, backupCodesRemaining: 10 });
      const audit = await prisma.mfaAuditEntry.findMany({ where: { userId: 'enrol-2' } });
      expect(audit.map((a) => a.action)).toEqual(['ENROLLED']);
    });

    it('will not begin again once enrolled (the factor cannot be swapped by a password alone)', async () => {
      await newUser('enrol-3');
      await enrol('enrol-3');
      expect(await mfa.beginEnrollment(prisma, { userId: 'enrol-3', account: 'x' })).toEqual({
        ok: false,
        reason: 'already_enrolled',
      });
    });
  });

  describe('verifySecondFactor with a TOTP code', () => {
    it('accepts the current code, and returns the enrolment it proves', async () => {
      await newUser('v-1');
      const e = await enrol('v-1', t0);
      const now = t0 + 90_000;
      const r = await mfa.verifySecondFactor(prisma, { userId: 'v-1', code: codeAt(e.secret, now), now });
      expect(r).toEqual({ ok: true, enabledAt: e.enabledAt });
    });

    it('rejects the same code a second time (replay), and the code of an earlier step', async () => {
      await newUser('v-2');
      const e = await enrol('v-2', t0);
      const now = t0 + 120_000;
      const code = codeAt(e.secret, now);
      expect((await mfa.verifySecondFactor(prisma, { userId: 'v-2', code, now })).ok).toBe(true);
      expect(await mfa.verifySecondFactor(prisma, { userId: 'v-2', code, now })).toEqual({ ok: false, reason: 'invalid' });
      // The previous step's code is inside the window but older than the one just spent.
      const older = codeAt(e.secret, now - 30_000);
      expect(await mfa.verifySecondFactor(prisma, { userId: 'v-2', code: older, now })).toEqual({ ok: false, reason: 'invalid' });
    });

    it('takes a code one step either side and refuses two steps away', async () => {
      await newUser('v-3');
      const e = await enrol('v-3', t0);
      const now = t0 + 300_000;
      expect((await mfa.verifySecondFactor(prisma, { userId: 'v-3', code: codeAt(e.secret, now - 30_000), now })).ok).toBe(true);
      expect((await mfa.verifySecondFactor(prisma, { userId: 'v-3', code: codeAt(e.secret, now + 90_000), now })).ok).toBe(false);
    });

    it('refuses someone who is not enrolled, or only half-enrolled', async () => {
      await newUser('v-4');
      expect(await mfa.verifySecondFactor(prisma, { userId: 'v-4', code: '123456', now: t0 })).toEqual({ ok: false, reason: 'not_enrolled' });
      await mfa.beginEnrollment(prisma, { userId: 'v-4', account: 'x' });
      expect(await mfa.verifySecondFactor(prisma, { userId: 'v-4', code: '123456', now: t0 })).toEqual({ ok: false, reason: 'not_enrolled' });
    });

    it('limits attempts: after five wrong codes even the right one is refused', async () => {
      await newUser('v-5');
      const e = await enrol('v-5', t0);
      const now = Date.now(); // the limiter's windows run on the real clock
      for (let i = 0; i < 5; i++) {
        expect(await mfa.verifySecondFactor(prisma, { userId: 'v-5', code: '000000', now })).toEqual({ ok: false, reason: 'invalid' });
      }
      const limited = await mfa.verifySecondFactor(prisma, { userId: 'v-5', code: codeAt(e.secret, now), now });
      expect(limited).toMatchObject({ ok: false, reason: 'limited' });
    });
  });

  describe('backup codes', () => {
    it('accepts a backup code once, then refuses the replay, and records the use', async () => {
      await newUser('b-1');
      const e = await enrol('b-1');
      const code = e.backupCodes[0];
      const first = await mfa.verifySecondFactor(prisma, { userId: 'b-1', code, now: t0 });
      expect(first).toEqual({ ok: true, enabledAt: e.enabledAt });
      expect(await mfa.verifySecondFactor(prisma, { userId: 'b-1', code, now: t0 })).toEqual({ ok: false, reason: 'invalid' });
      expect((await mfa.getMfaStatus(prisma, 'b-1')).backupCodesRemaining).toBe(9);
      const audit = await prisma.mfaAuditEntry.findMany({ where: { userId: 'b-1', action: 'BACKUP_CODE_USED' } });
      expect(audit).toHaveLength(1);
    });

    it('lets two simultaneous uses of one code succeed exactly once', async () => {
      await newUser('b-2');
      const e = await enrol('b-2');
      const code = e.backupCodes[3];
      const results = await Promise.all([
        mfa.verifySecondFactor(prisma, { userId: 'b-2', code, now: t0 }),
        mfa.verifySecondFactor(prisma, { userId: 'b-2', code, now: t0 }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
    });

    it('accepts the code however it is typed (case, spaces, dashes) and rejects a wrong one', async () => {
      await newUser('b-3');
      const e = await enrol('b-3');
      const typed = ` ${e.backupCodes[1].toUpperCase().replace('-', ' ')} `;
      expect((await mfa.verifySecondFactor(prisma, { userId: 'b-3', code: typed, now: t0 })).ok).toBe(true);
      expect((await mfa.verifySecondFactor(prisma, { userId: 'b-3', code: 'aaaaa-aaaaa', now: t0 })).ok).toBe(false);
    });

    it('regenerating needs a valid TOTP code, retires the old codes and issues ten new ones', async () => {
      await newUser('b-4');
      const e = await enrol('b-4', t0);
      const now = t0 + 600_000;
      expect(await mfa.regenerateBackupCodes(prisma, { userId: 'b-4', code: '000000', now })).toEqual({ ok: false, reason: 'invalid' });
      const r = await mfa.regenerateBackupCodes(prisma, { userId: 'b-4', code: codeAt(e.secret, now), now });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.backupCodes).toHaveLength(10);
      expect((await mfa.verifySecondFactor(prisma, { userId: 'b-4', code: e.backupCodes[0], now })).ok).toBe(false);
      expect((await mfa.verifySecondFactor(prisma, { userId: 'b-4', code: r.backupCodes[0], now })).ok).toBe(true);
    });
  });

  describe('reset by another Admin', () => {
    it('removes the factor and its codes, records who did it, and lets the person enrol afresh', async () => {
      await newUser('r-subject');
      await newUser('r-admin');
      await enrol('r-subject');
      const r = await mfa.resetMfa(prisma, { userId: 'r-subject', actedById: 'r-admin', reason: 'HP hilang' });
      expect(r).toEqual({ ok: true });
      expect(await mfa.getMfaStatus(prisma, 'r-subject')).toMatchObject({ enrolled: false, pending: false, backupCodesRemaining: 0 });
      const audit = await prisma.mfaAuditEntry.findMany({ where: { userId: 'r-subject', action: 'RESET' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actedById: 'r-admin', reason: 'HP hilang' });
      expect((await mfa.beginEnrollment(prisma, { userId: 'r-subject', account: 'x' })).ok).toBe(true);
    });

    it('refuses a self-reset, and a reset of someone with no factor', async () => {
      await newUser('r-self');
      await enrol('r-self');
      expect(await mfa.resetMfa(prisma, { userId: 'r-self', actedById: 'r-self', reason: 'uji' })).toEqual({ ok: false, reason: 'self' });
      await newUser('r-none');
      await newUser('r-admin-2');
      expect(await mfa.resetMfa(prisma, { userId: 'r-none', actedById: 'r-admin-2', reason: 'uji' })).toEqual({ ok: false, reason: 'not_enrolled' });
    });
  });
});
