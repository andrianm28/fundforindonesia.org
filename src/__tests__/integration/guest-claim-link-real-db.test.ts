// @vitest-environment node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * prd-audit 08: the claim link against a REAL Postgres, because what it
 * protects is which rows one transaction touches and whether a refused link
 * leaves the token unspent -- a JS mock only mirrors the queries it was told to
 * expect. Throwaway database, every migration replayed, visible skip when
 * TEST_DATABASE_URL is unset (same setup as guest-donation-claim-real-db.test.ts).
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return holder.client;
  },
}));

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const NOW = new Date('2026-10-03T10:00:00Z');
const HOUR = 60 * 60 * 1000;

describe.skipIf(!DATABASE_URL)('Guest Donor claim link -- against real Postgres (prd-audit 08)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[guest claim link] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `guest_claim_link_${process.pid}`;
  const tag = `gl${process.pid}`;
  let prisma: PrismaClient;
  let confirmGuestClaimLink: typeof import('@/lib/guest-claim-link').confirmGuestClaimLink;
  let campaignId: string;
  let seq = 0;

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
    ({ confirmGuestClaimLink } = await import('@/lib/guest-claim-link'));

    await makeUser('owner', { hmac: 'hmac-owner' });
    campaignId = `${tag}-campaign`;
    await prisma.campaign.create({
      data: {
        id: campaignId,
        slug: campaignId,
        title: 'Test Campaign',
        description: 'Test',
        story: 'Test',
        coverImage: 'https://example.com/cover.jpg',
        targetAmount: 10_000_000,
        category: 'test',
        creatorId: `${tag}-owner`,
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  async function makeUser(name: string, opts: { hmac: string; keyId?: string; verified?: boolean }) {
    const id = `${tag}-${name}`;
    await prisma.user.create({
      data: {
        id,
        name,
        emailHmac: opts.hmac,
        emailHmacKeyId: opts.keyId ?? 'k1',
        emailCiphertext: `${id}-c`,
        emailKeyId: 'k1',
        emailVerifiedAt: opts.verified === false ? null : new Date('2026-10-02T00:00:00Z'),
      },
    });
    return id;
  }

  async function makeGuestDonation(name: string, hmac: string | null, keyId: string | null = 'k1') {
    const id = `${tag}-d-${name}`;
    await prisma.donation.create({
      data: {
        id,
        amount: 100_000,
        paymentMethod: 'bank_transfer',
        campaignId,
        guestName: 'Guest',
        guestEmailHmac: hmac,
        guestEmailHmacKeyId: hmac ? keyId : null,
      },
    });
    return id;
  }

  /** A 43-character token whose hash is stored for `userId` with the account's lookup. */
  async function issue(
    userId: string,
    opts: { hmac: string; keyId?: string; expiresAt?: Date; usedAt?: Date | null },
  ): Promise<string> {
    const token = `${String(++seq).padStart(5, '0')}${'x'.repeat(38)}`;
    await prisma.guestClaimToken.create({
      data: {
        userId,
        tokenHash: sha(token),
        emailHmac: opts.hmac,
        emailHmacKeyId: opts.keyId ?? 'k1',
        expiresAt: opts.expiresAt ?? new Date(NOW.getTime() + 24 * HOUR),
        usedAt: opts.usedAt ?? null,
      },
    });
    return token;
  }

  const donorOf = async (id: string) =>
    (await prisma.donation.findUniqueOrThrow({ where: { id }, select: { donorId: true } })).donorId;
  const usedAt = async (token: string) =>
    (await prisma.guestClaimToken.findUniqueOrThrow({ where: { tokenHash: sha(token) }, select: { usedAt: true } })).usedAt;

  it('links the matching Guest Donations, spends the token, and leaves others alone', async () => {
    const account = await makeUser('a', { hmac: 'hmac-a' });
    const other = await makeUser('a-other', { hmac: 'hmac-a-other' });
    const mine1 = await makeGuestDonation('a-1', 'hmac-a');
    const mine2 = await makeGuestDonation('a-2', 'hmac-a');
    const theirs = await makeGuestDonation('a-theirs', 'hmac-a-other');
    const owned = await makeGuestDonation('a-owned', 'hmac-a');
    await prisma.donation.update({ where: { id: owned }, data: { donorId: other } });
    const token = await issue(account, { hmac: 'hmac-a' });

    expect(await confirmGuestClaimLink(account, token, NOW)).toEqual({ ok: true, claimed: 2 });

    expect(await donorOf(mine1)).toBe(account);
    expect(await donorOf(mine2)).toBe(account);
    expect(await donorOf(theirs)).toBeNull();
    expect(await donorOf(owned)).toBe(other);
    expect(await usedAt(token)).toEqual(NOW);
  });

  it('is single-use: replaying the token is refused and a fresh link claims nothing more', async () => {
    const account = await makeUser('b', { hmac: 'hmac-b' });
    const guest = await makeGuestDonation('b-1', 'hmac-b');
    const token = await issue(account, { hmac: 'hmac-b' });

    expect(await confirmGuestClaimLink(account, token, NOW)).toEqual({ ok: true, claimed: 1 });
    expect(await confirmGuestClaimLink(account, token, NOW)).toEqual({ ok: false });

    const second = await issue(account, { hmac: 'hmac-b' });
    expect(await confirmGuestClaimLink(account, second, NOW)).toEqual({ ok: true, claimed: 0 });
    expect(await donorOf(guest)).toBe(account);
  });

  it('refuses an expired token and one that is another account\'s, changing nothing', async () => {
    const account = await makeUser('c', { hmac: 'hmac-c' });
    const intruder = await makeUser('c-intruder', { hmac: 'hmac-c-intruder' });
    const guest = await makeGuestDonation('c-1', 'hmac-c');
    const expired = await issue(account, { hmac: 'hmac-c', expiresAt: new Date(NOW.getTime() - 1) });
    const live = await issue(account, { hmac: 'hmac-c' });

    expect(await confirmGuestClaimLink(account, expired, NOW)).toEqual({ ok: false });
    expect(await confirmGuestClaimLink(intruder, live, NOW)).toEqual({ ok: false });

    expect(await donorOf(guest)).toBeNull();
    expect(await usedAt(expired)).toBeNull();
    expect(await usedAt(live)).toBeNull();
  });

  it('does not touch a Donation that is anonymised or sealed under an older key id', async () => {
    const account = await makeUser('d', { hmac: 'hmac-d', keyId: 'k2' });
    const live = await makeGuestDonation('d-live', 'hmac-d', 'k2');
    const oldKey = await makeGuestDonation('d-old', 'hmac-d', 'k1');
    const anonymised = await makeGuestDonation('d-anon', 'hmac-d', 'k2');
    await prisma.donation.update({ where: { id: anonymised }, data: { anonymisedAt: new Date('2026-10-02T00:00:00Z') } });
    const token = await issue(account, { hmac: 'hmac-d', keyId: 'k2' });

    expect(await confirmGuestClaimLink(account, token, NOW)).toEqual({ ok: true, claimed: 1 });

    expect(await donorOf(live)).toBe(account);
    expect(await donorOf(oldKey)).toBeNull();
    expect(await donorOf(anonymised)).toBeNull();
  });

  it('rolls back and leaves the token unspent when the address changed since issue', async () => {
    const account = await makeUser('e', { hmac: 'hmac-e-new' });
    const guest = await makeGuestDonation('e-1', 'hmac-e-new');
    const token = await issue(account, { hmac: 'hmac-e-old' });

    expect(await confirmGuestClaimLink(account, token, NOW)).toEqual({ ok: false });

    expect(await usedAt(token)).toBeNull();
    expect(await donorOf(guest)).toBeNull();
  });

  it('rolls back and leaves the token unspent when the account is not verified', async () => {
    const account = await makeUser('f', { hmac: 'hmac-f', verified: false });
    const guest = await makeGuestDonation('f-1', 'hmac-f');
    const token = await issue(account, { hmac: 'hmac-f' });

    expect(await confirmGuestClaimLink(account, token, NOW)).toEqual({ ok: false });

    expect(await usedAt(token)).toBeNull();
    expect(await donorOf(guest)).toBeNull();
  });

  it('of two concurrent opens of one link, exactly one spends it', async () => {
    const account = await makeUser('g', { hmac: 'hmac-g' });
    await makeGuestDonation('g-1', 'hmac-g');
    const token = await issue(account, { hmac: 'hmac-g' });

    const results = await Promise.all([
      confirmGuestClaimLink(account, token, NOW),
      confirmGuestClaimLink(account, token, NOW),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });
});
