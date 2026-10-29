// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * failPayout's two-person edge against a REAL Postgres (owner decision
 * 2026-10-29): the Admin who approved a Payout may not be the one who marks
 * it failed; a different Admin may. Same throwaway-database setup as
 * campaign-transfer-real-db.test.ts, and a visible skip without TEST_DATABASE_URL.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('failPayout two-person rule -- against real Postgres', () => {
  const databaseName = `payout_fail_${process.pid}`;
  let prisma: PrismaClient;
  let payouts: typeof import('@/lib/money/payouts');
  let ledger: typeof import('@/lib/money/ledger');

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
      const dirs = readdirSync('prisma/migrations')
        .filter((d) => !d.startsWith('migration_lock'))
        .sort();
      for (const dir of dirs) await migrator.query(readFileSync(join('prisma/migrations', dir, 'migration.sql'), 'utf8'));
    } finally {
      await migrator.end();
    }

    const adapter = new PrismaPg({ connectionString: url });
    const { PrismaClient: RealPrismaClient } = await import('@/generated/prisma/client');
    prisma = new RealPrismaClient({ adapter });
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    payouts = await import('@/lib/money/payouts');
    ledger = await import('@/lib/money/ledger');
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
    await prisma.user.create({
      data: { id, name: 'Test', emailHmac: `${id}-hmac`, emailHmacKeyId: 'k', emailCiphertext: `${id}-c`, emailKeyId: 'k' },
    });
    return id;
  }

  /** An APPROVED Payout (instruction journal posted), approved by `approverId`. */
  async function makeApprovedPayout(approverId: string): Promise<string> {
    const ownerId = await makeUser();
    const requesterId = await makeUser();
    const campaignId = `campaign-${process.pid}-${next()}`;
    await prisma.campaign.create({
      data: {
        id: campaignId,
        slug: campaignId,
        title: campaignId,
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 10_000_000,
        category: 'Zakat Maal',
        kind: 'ZAKAT',
        creatorId: ownerId,
        lifecycleStatus: 'ACTIVE',
      },
    });
    const bank = await prisma.bankAccount.create({
      data: {
        ownerId,
        bankCode: 'BCA',
        accountNumberCiphertext: 'c',
        accountNumberKeyId: 'k',
        accountName: 'Test',
        verifiedAt: new Date(),
      },
    });
    const payout = await prisma.payout.create({
      data: {
        campaignId,
        bankAccountId: bank.id,
        amount: 500_000,
        description: 'd',
        status: 'APPROVED',
        requestedById: requesterId,
        approvedById: approverId,
        approvedAt: new Date(),
      },
    });
    await prisma.$transaction(async (tx) => {
      await ledger.postTransaction(tx, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 500_000 },
        { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 500_000, campaignId },
      ]);
      await ledger.postTransaction(tx, ledger.payoutInstructedLegs({ subject: { type: 'campaign', campaignId }, amount: 500_000 }), {
        payoutId: payout.id,
        transactionId: `payout-instructed-${payout.id}`,
      });
    });
    return payout.id;
  }

  it('refuses the Admin who approved the Payout, writing nothing', async () => {
    const approver = await makeUser();
    const payoutId = await makeApprovedPayout(approver);

    await expect(payouts.failPayout(prisma, { payoutId, failedById: approver, reason: 'Transfer ditolak' })).rejects.toThrow(
      payouts.TwoPersonRuleError,
    );

    const row = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(row.status).toBe('APPROVED');
    expect(await prisma.ledgerEntry.count({ where: { transactionId: `payout-failed-${payoutId}` } })).toBe(0);
  });

  it('lets a different Admin mark it failed, returning the money', async () => {
    const approver = await makeUser();
    const other = await makeUser();
    const payoutId = await makeApprovedPayout(approver);

    const result = await payouts.failPayout(prisma, { payoutId, failedById: other, reason: 'Transfer ditolak' });

    expect(result.status).toBe('FAILED');
    expect(await prisma.ledgerEntry.count({ where: { transactionId: `payout-failed-${payoutId}` } })).toBe(2);
  });
});
