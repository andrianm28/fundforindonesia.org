// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * "Payment yang dihitung" (ticket rilis-1-benda/92) against a REAL Postgres.
 *
 * The claim: a Campaign that took one beta (sandbox-stamped) Payment and one
 * live Payment shows BOTH on the Impact page while the beta marker is on, and
 * only the live one once the marker is off -- and the page still reconciles in
 * both modes, because the pools are read without the sandbox Payment's legs.
 * A JS fake cannot show that the conservation law still holds; the real
 * ledger can. Same setup as refund-reject-fail-real-db.test.ts.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Payment yang dihitung -- against real Postgres (ticket 92)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[beta sandbox] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `beta_sandbox_${process.pid}`;
  let prisma: PrismaClient;
  let ledger: typeof import('@/lib/money/ledger');
  let impact: typeof import('@/lib/money/impact');
  let counted: typeof import('@/lib/money/counted-payment');

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
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    ledger = await import('@/lib/money/ledger');
    impact = await import('@/lib/money/impact');
    counted = await import('@/lib/money/counted-payment');
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  let counter = 0;
  const next = () => counter++;

  async function makeCampaign(location: string): Promise<string> {
    const ownerId = `u-${process.pid}-${next()}`;
    await prisma.user.create({
      data: {
        id: ownerId,
        name: 'Test',
        emailHmac: `${ownerId}-hmac`,
        emailHmacKeyId: 'k',
        emailCiphertext: `${ownerId}-c`,
        emailKeyId: 'k',
      },
    });
    const id = `campaign-${process.pid}-${next()}`;
    await prisma.campaign.create({
      data: {
        id,
        slug: id,
        title: `Campaign ${id}`,
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 10_000_000,
        category: 'Zakat Maal',
        kind: 'ZAKAT',
        creatorId: ownerId,
        lifecycleStatus: 'ACTIVE',
        location,
      },
    });
    return id;
  }

  /** A PAID Payment settled into ESCROW_HOLD, stamped sandbox or live, counter incremented as the webhook does. */
  async function seedSettled(campaignId: string, gross: number, sandbox: boolean) {
    const providerFee = Math.floor(gross / 20);
    const platformFee = Math.floor(gross / 40);
    const donationId = `donation-${process.pid}-${next()}`;
    await prisma.donation.create({ data: { id: donationId, amount: gross, paymentMethod: 'bank_transfer', campaignId } });
    const payment = await prisma.payment.create({
      data: {
        donationId,
        provider: 'sumopod',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: gross,
        providerFee,
        platformFee,
        sandbox,
        status: 'PAID',
      },
    });
    await prisma.$transaction(async (tx) => {
      await ledger.postTransaction(
        tx,
        ledger.paymentSettledLegs({
          subject: { type: 'campaign', campaignId },
          grossAmount: gross,
          providerFee,
          platformFee,
        }),
        { paymentId: payment.id },
      );
      await tx.campaign.update({ where: { id: campaignId }, data: { collectedAmount: { increment: gross } } });
    });
    return payment;
  }

  async function impactFor(location: string) {
    const breakdown = await impact.impactBreakdown(prisma, { location });
    return {
      collected: breakdown.collected,
      lines: Object.fromEntries(breakdown.lines.map((l) => [l.key, l.amount])),
    };
  }

  it('Impact counts the beta Payment in the beta, and leaves it out live, reconciling both times', async () => {
    const location = `beta-impact-${process.pid}`;
    const campaignId = await makeCampaign(location);
    await seedSettled(campaignId, 400_000, false);
    await seedSettled(campaignId, 100_000, true);

    vi.stubEnv('BETA_SANDBOX', 'true');
    const inBeta = await impactFor(location);
    expect(inBeta.collected).toBe(500_000);

    vi.stubEnv('BETA_SANDBOX', '');
    const live = await impactFor(location);
    expect(live.collected).toBe(400_000);
    // Both held in escrow, so the held line is the net of the live one alone.
    expect(live.lines.heldInEscrowHold).toBe(400_000 - 20_000 - 10_000);
  });

  it('a Campaign with only beta Payments reads zero live, and the page does not throw', async () => {
    const location = `beta-only-${process.pid}`;
    const campaignId = await makeCampaign(location);
    await seedSettled(campaignId, 250_000, true);

    vi.stubEnv('BETA_SANDBOX', '');
    const live = await impactFor(location);

    expect(live.collected).toBe(0);
    expect(Object.values(live.lines).every((v) => v === 0)).toBe(true);
  });

  it('public progress is the stored counter less the beta Gross once the marker is off', async () => {
    const campaignId = await makeCampaign(`beta-progress-${process.pid}`);
    await seedSettled(campaignId, 400_000, false);
    await seedSettled(campaignId, 100_000, true);
    const rows = await prisma.campaign.findMany({ where: { id: campaignId }, select: { id: true, collectedAmount: true } });
    expect(rows[0].collectedAmount).toBe(500_000);

    vi.stubEnv('BETA_SANDBOX', 'true');
    expect((await counted.withCountedCollectedAmount(prisma, rows))[0].collectedAmount).toBe(500_000);

    vi.stubEnv('BETA_SANDBOX', '');
    expect((await counted.withCountedCollectedAmount(prisma, rows))[0].collectedAmount).toBe(400_000);
  });

  it('countedPaymentWhere selects the same rows the helpers do', async () => {
    const campaignId = await makeCampaign(`beta-where-${process.pid}`);
    await seedSettled(campaignId, 40_000, false);
    await seedSettled(campaignId, 60_000, true);
    const scope = { donation: { campaignId } };

    vi.stubEnv('BETA_SANDBOX', 'true');
    expect(await prisma.payment.count({ where: { ...scope, ...counted.countedPaymentWhere() } })).toBe(2);

    vi.stubEnv('BETA_SANDBOX', '');
    expect(await prisma.payment.count({ where: { ...scope, ...counted.countedPaymentWhere() } })).toBe(1);
  });
});
