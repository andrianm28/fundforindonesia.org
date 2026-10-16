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
 * Ticket 90: the Admin-set Escrow Hold length is copied onto each Payment when
 * it is created and never recomputed, against a REAL Postgres.
 *
 * A mock cannot show the two properties that make this safe for Donors' money:
 * a later Admin change moves no Payment that already exists, and a shortened
 * default never releases a Payment frozen under a longer hold early. Both are
 * driven here through the real chargeDonation, the real settlement webhook and
 * the real release sweep. Setup follows webhook-paid-after-expiry-real-db.test.ts;
 * skipped visibly, not passed, when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SERVER_KEY = 'test-mock-server-key';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Escrow Hold setting -- against real Postgres (ticket 90)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[escrow hold setting real db] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `escrow_hold_setting_${process.pid}`;
  let prisma: PrismaClient;
  let webhook: typeof import('@/app/api/webhooks/[provider]/route').POST;
  let sealUserEmail: typeof import('@/lib/contact-fields').sealUserEmail;
  let provider: import('@/lib/payments').MockPaymentProvider;
  let config: typeof import('@/lib/money/escrow-hold-config');
  let charge: typeof import('@/lib/money/donation-charge');
  let escrow: typeof import('@/lib/money/escrow');

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    process.env.MOCK_MIDTRANS_SERVER_KEY = SERVER_KEY;
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
    vi.doMock('@/lib/mail', async () => {
      const actual = await vi.importActual<typeof import('@/lib/mail')>('@/lib/mail');
      return { ...actual, sendReportingFailure: async () => true };
    });
    ({ POST: webhook } = await import('@/app/api/webhooks/[provider]/route'));
    ({ sealUserEmail } = await import('@/lib/contact-fields'));
    config = await import('@/lib/money/escrow-hold-config');
    charge = await import('@/lib/money/donation-charge');
    escrow = await import('@/lib/money/escrow');
    const payments = await import('@/lib/payments');
    provider = new payments.MockPaymentProvider({ serverKey: SERVER_KEY });
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

  async function makeUser(): Promise<string> {
    const id = `u-${process.pid}-${next()}`;
    await prisma.user.create({ data: { id, name: 'Test User', ...sealUserEmail(`${id}@example.test`) } });
    return id;
  }

  async function makeCampaign(category = 'test') {
    const creatorId = await makeUser();
    const registrarId = await makeUser();
    const entity = await prisma.partnerOrganisation.create({
      data: { name: 'Yayasan Uji', fundraiserId: creatorId, registeredById: registrarId },
    });
    const id = `c-${process.pid}-${next()}`;
    return prisma.campaign.create({
      data: {
        id,
        slug: id,
        title: 'Kampanye Uji',
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 10_000_000,
        category,
        creatorId,
        lifecycleStatus: 'ACTIVE',
        collectingEntityId: entity.id,
      },
    });
  }

  /** A real chargeDonation for a fresh Donation on `campaign`; returns the Payment it wrote. */
  async function donate(campaign: Awaited<ReturnType<typeof makeCampaign>>) {
    const donorId = await makeUser();
    const donation = await prisma.donation.create({
      data: { amount: 100_000, paymentMethod: 'bank_transfer_va', campaignId: campaign.id, donorId },
    });
    const result = await charge.chargeDonation({
      db: prisma,
      provider,
      campaign,
      donationId: donation.id,
      amount: 100_000,
      orderId: donation.id,
      paymentMethod: 'bank_transfer_va',
    });
    if (!result.ok) throw new Error(`chargeDonation failed: ${result.reason}`);
    return prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
  }

  async function settle(providerRef: string) {
    const body = await provider.simulateWebhookPayload(providerRef, 100_000, 'settlement', `evt-${providerRef}`);
    const res = await webhook(
      new NextRequest('http://localhost/api/webhooks/mock', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ provider: 'mock' }) },
    );
    expect(res.status).toBe(200);
    return prisma.payment.findUniqueOrThrow({ where: { providerRef } });
  }

  it('with no setting at all, a Payment freezes the 7-day fallback', async () => {
    const payment = await donate(await makeCampaign('tanpa-setelan'));
    expect(payment.escrowHoldDays).toBe(7);
  });

  it('a Payment freezes the Admin default in force when it is created, and a later change moves no existing Payment', async () => {
    const adminId = await makeUser();
    const campaign = await makeCampaign('kategori-a');

    await config.setEscrowHoldSetting(prisma, { scope: 'DEFAULT', days: 3, actorId: adminId });
    const before = await donate(campaign);
    await config.setEscrowHoldSetting(prisma, { scope: 'DEFAULT', days: 20, actorId: adminId });
    const after = await donate(campaign);

    expect(before.escrowHoldDays).toBe(3);
    expect(after.escrowHoldDays).toBe(20);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: before.id } })).escrowHoldDays).toBe(3);

    // Settlement reads the Payment's own copy, not the setting.
    const settled = await settle(before.providerRef);
    expect(settled.escrowReleaseAt!.getTime() - settled.settledAt!.getTime()).toBe(3 * MS_PER_DAY);
    const settledAfter = await settle(after.providerRef);
    expect(settledAfter.escrowReleaseAt!.getTime() - settledAfter.settledAt!.getTime()).toBe(20 * MS_PER_DAY);

    await config.setEscrowHoldSetting(prisma, { scope: 'DEFAULT', days: 7, actorId: adminId });
  });

  it('a Category override wins over the default for that Category only, and every change is a new row with its actor', async () => {
    const adminId = await makeUser();
    const disaster = await makeCampaign('bencana-uji');
    const other = await makeCampaign('lain-uji');

    await config.setEscrowHoldSetting(prisma, { scope: 'DEFAULT', days: 10, actorId: adminId });
    await config.setEscrowHoldSetting(prisma, { scope: 'CATEGORY', category: 'bencana-uji', days: 2, actorId: adminId });

    expect((await donate(disaster)).escrowHoldDays).toBe(2);
    expect((await donate(other)).escrowHoldDays).toBe(10);

    const rows = await prisma.escrowHoldSetting.findMany({ where: { setById: adminId }, orderBy: { setAt: 'asc' } });
    expect(rows.map((r) => [r.scope, r.category, r.days])).toEqual([
      ['DEFAULT', null, 10],
      ['CATEGORY', 'bencana-uji', 2],
    ]);
  });

  it('shortening the default mid-hold never releases a Payment frozen under the longer hold early', async () => {
    const adminId = await makeUser();
    const campaign = await makeCampaign('kategori-b');

    await config.setEscrowHoldSetting(prisma, { scope: 'DEFAULT', days: 14, actorId: adminId });
    const longHold = await donate(campaign);
    const settled = await settle(longHold.providerRef);

    // The Admin shortens the hold while that Payment is still being held...
    await config.setEscrowHoldSetting(prisma, { scope: 'DEFAULT', days: 1, actorId: adminId });
    const shortHold = await donate(campaign);
    await settle(shortHold.providerRef);

    // ...three days on, only the Payment created under the short hold matures.
    const threeDaysOn = new Date(settled.settledAt!.getTime() + 3 * MS_PER_DAY);
    await escrow.releaseMaturedEscrow({ type: 'campaign', id: campaign.id }, threeDaysOn);

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: longHold.id } })).escrowReleasedAt).toBeNull();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: shortHold.id } })).escrowReleasedAt).not.toBeNull();

    // And the long one is released once ITS 14 days are up.
    const fifteenDaysOn = new Date(settled.settledAt!.getTime() + 15 * MS_PER_DAY);
    await escrow.releaseMaturedEscrow({ type: 'campaign', id: campaign.id }, fifteenDaysOn);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: longHold.id } })).escrowReleasedAt).not.toBeNull();
  });
});
