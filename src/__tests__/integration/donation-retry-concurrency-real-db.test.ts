// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * PR #273 review, S1: two "Coba bayar lagi" requests for one Donation racing
 * (two tabs, a double click, a script) must open ONE new charge, not two. The
 * paid-once index stops a second credit, but a second live charge is money a
 * Donor can still pay with nothing to credit it to.
 *
 * Only a real Postgres can show this: the guard is a transaction-scoped
 * advisory lock (src/lib/donation-retry.ts), which a mocked client grants to
 * everyone.
 * The provider is slowed down so both requests are inside the charge at once.
 * Skipped visibly, not passed, when TEST_DATABASE_URL is unset.
 *
 * (Setup follows webhook-paid-after-expiry-real-db.test.ts.)
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('donation retry concurrency -- against real Postgres', () => {
  if (!DATABASE_URL) {
    console.warn('[donation retry real db] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `donation_retry_${process.pid}`;
  let prisma: PrismaClient;
  let retryByToken: typeof import('@/app/api/donations/result/[token]/retry/route').POST;
  let signToken: typeof import('@/lib/money/payment-result-token').signPaymentResultToken;
  let sealUserEmail: typeof import('@/lib/contact-fields').sealUserEmail;
  const createCharge = vi.fn();

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.FIELD_ENCRYPTION_KEY_ID = 'enc-1';
    process.env.FIELD_HMAC_KEY = randomBytes(32).toString('base64');
    process.env.FIELD_HMAC_KEY_ID = 'hmac-1';
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

    vi.doMock('@/lib/prisma', () => ({ prisma, default: prisma }));
    vi.doMock('@/lib/donations', async () => {
      const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
      return { ...actual, donationsEnabled: () => true, sandboxInProductionReason: () => null };
    });
    vi.doMock('@/lib/payments/active-provider', async () => {
      const actual = await vi.importActual<typeof import('@/lib/payments/active-provider')>('@/lib/payments/active-provider');
      return {
        ...actual,
        resolveActivePaymentProvider: async () => ({
          provider: { name: 'mock', method: 'qris_redirect', supportedMethods: ['qris_redirect'], createCharge },
          enabledMethods: ['qris_redirect'],
        }),
      };
    });
    ({ POST: retryByToken } = await import('@/app/api/donations/result/[token]/retry/route'));
    ({ signPaymentResultToken: signToken } = await import('@/lib/money/payment-result-token'));
    ({ sealUserEmail } = await import('@/lib/contact-fields'));
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
  const next = () => counter++;

  async function expiredGuestDonation() {
    const n = next();
    const creatorId = `u-${process.pid}-${n}-c`;
    const registrarId = `u-${process.pid}-${n}-r`;
    for (const id of [creatorId, registrarId]) {
      await prisma.user.create({ data: { id, name: 'Uji', ...sealUserEmail(`${id}@example.test`) } });
    }
    const entity = await prisma.partnerOrganisation.create({
      data: { name: `Yayasan Uji ${n}`, fundraiserId: creatorId, registeredById: registrarId },
    });
    await prisma.fundraisingPermit.create({
      data: {
        partnerOrganisationId: entity.id,
        number: `P-${n}`,
        issuer: 'Uji',
        kinds: ['DONATION'],
        validFrom: new Date('2020-01-01T00:00:00Z'),
        validTo: new Date('2099-12-31T00:00:00Z'),
        recordedById: registrarId,
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        slug: `c-${process.pid}-${n}`,
        title: 'Kampanye Uji',
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 10_000_000,
        category: 'test',
        creatorId,
        lifecycleStatus: 'ACTIVE',
        collectingEntityId: entity.id,
      },
    });
    const donation = await prisma.donation.create({
      data: { amount: 100_000, paymentMethod: 'qris', campaignId: campaign.id, guestName: 'Tamu Uji' },
    });
    await prisma.payment.create({
      data: {
        donationId: donation.id,
        provider: 'mock',
        method: 'qris_redirect',
        providerRef: `ref-${process.pid}-${n}`,
        amount: 100_000,
        status: 'EXPIRED',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    return donation;
  }

  function retry(token: string, address: string) {
    return retryByToken(
      new NextRequest(`http://localhost/api/donations/result/${token}/retry`, {
        method: 'POST',
        headers: { 'x-forwarded-for': address },
      }),
      { params: Promise.resolve({ token }) },
    );
  }

  it('two retries racing on one Donation open exactly one new charge; the loser gets 409', async () => {
    const donation = await expiredGuestDonation();
    createCharge.mockImplementation(async ({ orderId }: { orderId: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        providerOrderId: orderId,
        method: 'qris_redirect',
        redirectUrl: `https://pay.example/${orderId}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };
    });
    const token = signToken(donation.id, Date.now());

    const responses = await Promise.all([retry(token, '203.0.113.1'), retry(token, '203.0.113.2')]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(createCharge).toHaveBeenCalledTimes(1);
    const pending = await prisma.payment.findMany({ where: { donationId: donation.id, status: 'PENDING' } });
    expect(pending).toHaveLength(1);
    expect(pending[0].redirectUrl).toMatch(/^https:\/\/pay\.example\//);

    // And once the winner's charge is open, a later retry is refused too.
    const later = await retry(token, '203.0.113.3');
    expect(later.status).toBe(409);
    expect(createCharge).toHaveBeenCalledTimes(1);
  }, 30_000);
});
