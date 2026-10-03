// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * prd-compliance 23: the Guest Donor claim against a REAL Postgres, because
 * what it protects is which rows an UPDATE touches, and a JS mock only mirrors
 * the query it was told to expect. Throwaway database, every migration replayed,
 * visible skip when TEST_DATABASE_URL is unset (same setup as
 * email-verification-concurrency.test.ts).
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

describe.skipIf(!DATABASE_URL)('Guest Donor claim -- against real Postgres (prd-compliance 23)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[guest donation claim] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `guest_claim_${process.pid}`;
  const tag = `gc${process.pid}`;
  let prisma: PrismaClient;
  let claimGuestDonations: typeof import('@/lib/guest-donation-claim').claimGuestDonations;
  let campaignId: string;

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
    ({ claimGuestDonations } = await import('@/lib/guest-donation-claim'));

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
        emailVerifiedAt: opts.verified ? new Date('2026-10-02T00:00:00Z') : null,
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

  const donorOf = async (id: string) =>
    (await prisma.donation.findUniqueOrThrow({ where: { id }, select: { donorId: true } })).donorId;

  it("a verified account claims its own address's Donations and not another guest's", async () => {
    const accountA = await makeUser('a', { hmac: 'hmac-a', verified: true });
    const mine = await makeGuestDonation('a-mine', 'hmac-a');
    const theirs = await makeGuestDonation('a-theirs', 'hmac-b');

    const result = await claimGuestDonations(accountA);

    expect(result).toEqual({ verified: true, claimed: 1 });
    expect(await donorOf(mine)).toBe(accountA);
    expect(await donorOf(theirs)).toBeNull();
  });

  it('an unverified account claims nothing, even with the exact same address', async () => {
    const accountB = await makeUser('b', { hmac: 'hmac-b2', verified: false });
    const guest = await makeGuestDonation('b-guest', 'hmac-b2');

    expect(await claimGuestDonations(accountB)).toEqual({ verified: false, claimed: 0 });
    expect(await donorOf(guest)).toBeNull();
  });

  it('is idempotent: a second claim changes nothing and takes nothing from the first claimant', async () => {
    const accountC = await makeUser('c', { hmac: 'hmac-c', verified: true });
    const guest = await makeGuestDonation('c-guest', 'hmac-c');

    expect(await claimGuestDonations(accountC)).toEqual({ verified: true, claimed: 1 });
    expect(await claimGuestDonations(accountC)).toEqual({ verified: true, claimed: 0 });
    expect(await donorOf(guest)).toBe(accountC);
  });

  it('fails safe after a key rotation: a Donation under the old key id is not claimed by an account on the new one', async () => {
    const rotated = await makeUser('rot', { hmac: 'hmac-rot', keyId: 'k2', verified: true });
    const oldKey = await makeGuestDonation('rot-old', 'hmac-rot', 'k1');
    const newKey = await makeGuestDonation('rot-new', 'hmac-rot', 'k2');

    expect(await claimGuestDonations(rotated)).toEqual({ verified: true, claimed: 1 });
    expect(await donorOf(oldKey)).toBeNull();
    expect(await donorOf(newKey)).toBe(rotated);
  });

  it('never claims a Donation marked anonymisedAt, even if its HMAC still matches', async () => {
    const accountE = await makeUser('e', { hmac: 'hmac-e', verified: true });
    const anonymised = await makeGuestDonation('e-anon', 'hmac-e');
    const live = await makeGuestDonation('e-live', 'hmac-e');
    await prisma.donation.update({ where: { id: anonymised }, data: { anonymisedAt: new Date('2026-10-02T00:00:00Z') } });

    expect(await claimGuestDonations(accountE)).toEqual({ verified: true, claimed: 1 });
    expect(await donorOf(anonymised)).toBeNull();
    expect(await donorOf(live)).toBe(accountE);
  });

  it('never claims a Donation whose HMAC was cleared (the anonymised shape, PR #172)', async () => {
    const accountD = await makeUser('d', { hmac: 'hmac-d', verified: true });
    const cleared = await makeGuestDonation('d-cleared', null);

    expect(await claimGuestDonations(accountD)).toEqual({ verified: true, claimed: 0 });
    expect(await donorOf(cleared)).toBeNull();
  });
});
