// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Campaign Transfer (prd-compliance 33) against a REAL Postgres.
 *
 * What a JS fake cannot prove is the thing that makes the money safe: that two
 * transactions racing on one source Campaign serialise on its row lock, so a
 * balance that covers one transfer funds exactly one, and that a transfer
 * racing a Refund on the same Campaign neither deadlocks nor double-spends.
 * Same setup as stuck-refund-sweep.test.ts: a throwaway database migrated by
 * replaying every migration, and a visible skip when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Campaign Transfer -- against real Postgres (prd-compliance 33)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[campaign transfer] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `campaign_transfer_${process.pid}`;
  let prisma: PrismaClient;
  let transfers: typeof import('@/lib/money/campaign-transfers');
  let refunds: typeof import('@/lib/money/refunds');
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
    transfers = await import('@/lib/money/campaign-transfers');
    refunds = await import('@/lib/money/refunds');
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
      data: {
        id,
        name: 'Test',
        emailHmac: `${id}-hmac`,
        emailHmacKeyId: 'k',
        emailCiphertext: `${id}-c`,
        emailKeyId: 'k',
      },
    });
    return id;
  }

  async function makeCampaign(opts: {
    status: 'ACTIVE' | 'SUSPENDED';
    kind?: 'ZAKAT' | 'WAKAF';
    category?: string;
    /** The Campaign's balance, seeded as a balanced journal against the provider clearing account. */
    balance?: number;
  }): Promise<{ id: string; ownerId: string }> {
    const ownerId = await makeUser();
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
        category: opts.category ?? 'Zakat Maal',
        kind: opts.kind ?? 'ZAKAT',
        creatorId: ownerId,
        lifecycleStatus: opts.status,
      },
    });
    if (opts.balance) {
      await prisma.$transaction((tx) =>
        ledger.postTransaction(tx, [
          { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: opts.balance! },
          { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: opts.balance!, campaignId: id },
        ]),
      );
    }
    return { id, ownerId };
  }

  async function balanceOf(campaignId: string): Promise<number> {
    return prisma.$transaction((tx) => ledger.campaignBalance(tx, campaignId));
  }

  async function requestTransfer(sourceId: string, targetId: string, requestedById: string) {
    return prisma.$transaction((tx) =>
      transfers.requestCampaignTransfer(tx, {
        sourceId,
        targetId,
        reason: 'Campaign asal disuspend',
        requestedById,
      }),
    );
  }

  /** The debits and credits of every posted transaction must match, whatever raced. */
  async function expectLedgerBalanced(): Promise<void> {
    const rows = await prisma.ledgerEntry.findMany({ select: { transactionId: true, direction: true, amount: true } });
    const net = new Map<string, number>();
    for (const r of rows) {
      net.set(r.transactionId, (net.get(r.transactionId) ?? 0) + (r.direction === 'DEBIT' ? r.amount : -r.amount));
    }
    for (const [transactionId, sum] of net) expect(`${transactionId}:${sum}`).toBe(`${transactionId}:0`);
  }

  it('two full transfers from one source (each captured the whole balance): exactly one is approved', async () => {
    const source = await makeCampaign({ status: 'SUSPENDED', balance: 500_000 });
    const target = await makeCampaign({ status: 'ACTIVE' });
    const requester = await makeUser();
    const approverA = await makeUser();
    const approverB = await makeUser();

    // Each captures the whole 500k balance, so both requests are accepted.
    const first = await requestTransfer(source.id, target.id, requester);
    const second = await requestTransfer(source.id, target.id, requester);

    const outcomes = await Promise.allSettled([
      transfers.approveCampaignTransfer(prisma, { campaignTransferId: first.id, decidedById: approverA }),
      transfers.approveCampaignTransfer(prisma, { campaignTransferId: second.id, decidedById: approverB }),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(transfers.InsufficientBalanceError);

    expect(await balanceOf(source.id)).toBe(0);
    expect(await balanceOf(target.id)).toBe(500_000);
    expect(await prisma.campaignTransfer.count({ where: { sourceId: source.id, status: 'APPROVED' } })).toBe(1);
    expect(await prisma.campaignTransfer.count({ where: { sourceId: source.id, status: 'PENDING' } })).toBe(1);
    await expectLedgerBalanced();
  }, 60_000);

  it('two transfers that cross (A to B and B to A) do not deadlock', async () => {
    // Both Campaigns Active at request time would refuse a Suspended-only
    // source, so each is Suspended and the other is flipped Active only for
    // the request, then back, to make both approvable pairs cross in lock order.
    const a = await makeCampaign({ status: 'SUSPENDED', balance: 300_000 });
    const b = await makeCampaign({ status: 'SUSPENDED', balance: 300_000 });
    const requester = await makeUser();
    const approverA = await makeUser();
    const approverB = await makeUser();

    await prisma.campaign.update({ where: { id: b.id }, data: { lifecycleStatus: 'ACTIVE' } });
    const aToB = await requestTransfer(a.id, b.id, requester);
    await prisma.campaign.update({ where: { id: b.id }, data: { lifecycleStatus: 'SUSPENDED' } });
    await prisma.campaign.update({ where: { id: a.id }, data: { lifecycleStatus: 'ACTIVE' } });
    const bToA = await requestTransfer(b.id, a.id, requester);

    // Approving either now fails its own re-judgement (the target is no longer
    // Active), which is the point: both still take the same two locks in the
    // same order and finish, instead of waiting on each other forever.
    const outcomes = await Promise.race([
      Promise.allSettled([
        transfers.approveCampaignTransfer(prisma, { campaignTransferId: aToB.id, decidedById: approverA }),
        transfers.approveCampaignTransfer(prisma, { campaignTransferId: bToA.id, decidedById: approverB }),
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('deadlock: approvals did not finish')), 30_000)),
    ]);
    expect(outcomes).toHaveLength(2);
    await expectLedgerBalanced();
  }, 60_000);

  it('a transfer racing a Refund on the same Campaign both settle, and the ledger stays balanced', async () => {
    const source = await makeCampaign({ status: 'SUSPENDED', balance: 500_000 });
    const target = await makeCampaign({ status: 'ACTIVE' });
    const requester = await makeUser();
    const approver = await makeUser();
    const refundAdmin = await makeUser();

    const donationId = `donation-${process.pid}-${next()}`;
    await prisma.donation.create({
      data: { id: donationId, amount: 300_000, paymentMethod: 'bank_transfer', campaignId: source.id },
    });
    const payment = await prisma.payment.create({
      data: {
        donationId,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: 300_000,
        status: 'PAID',
        // Already released, so a Refund draws the withdrawable balance.
        escrowReleasedAt: new Date(Date.now() - 60_000),
      },
    });

    const transfer = await requestTransfer(source.id, target.id, requester);

    // Whoever wins the lock, the loser is refused rather than overdrawing:
    // the transfer is full (500k), so a Refund that lands first changes the
    // balance and the approval is refused; a transfer that lands first leaves
    // nothing for the Refund.
    const outcomes = await Promise.allSettled([
      transfers.approveCampaignTransfer(prisma, { campaignTransferId: transfer.id, decidedById: approver }),
      prisma.$transaction((tx) =>
        refunds.createRefund(tx, {
          subject: { type: 'campaign', campaignId: source.id },
          paymentId: payment.id,
          amount: 300_000,
          reason: 'salah bayar',
          requestedById: refundAdmin,
        }),
      ),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf(source.id)).toBeGreaterThanOrEqual(0);
    expect((await balanceOf(source.id)) + (await balanceOf(target.id))).toBeLessThanOrEqual(500_000);
    await expectLedgerBalanced();
  }, 60_000);

  it('a follow-up transfer is allowed after an APPROVED one: matured Escrow Hold moves the same way', async () => {
    const source = await makeCampaign({ status: 'SUSPENDED', balance: 300_000 });
    const target = await makeCampaign({ status: 'ACTIVE' });
    const requester = await makeUser();
    const approver = await makeUser();

    const first = await requestTransfer(source.id, target.id, requester);
    await transfers.approveCampaignTransfer(prisma, { campaignTransferId: first.id, decidedById: approver });

    // Escrow Hold matures into the source's withdrawable balance afterwards.
    await prisma.$transaction((tx) =>
      ledger.postTransaction(tx, [
        { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 80_000 },
        { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 80_000, campaignId: source.id },
      ]),
    );

    const second = await requestTransfer(source.id, target.id, requester);
    expect(second.amount).toBe(80_000);
    await transfers.approveCampaignTransfer(prisma, { campaignTransferId: second.id, decidedById: approver });

    expect(await balanceOf(source.id)).toBe(0);
    expect(await balanceOf(target.id)).toBe(380_000);
    expect(await prisma.campaignTransfer.count({ where: { sourceId: source.id, status: 'APPROVED' } })).toBe(2);
    await expectLedgerBalanced();
  }, 60_000);

  it('a Kind changed after the request stops the approval, and nothing moves', async () => {
    const source = await makeCampaign({ status: 'SUSPENDED', balance: 300_000 });
    const target = await makeCampaign({ status: 'ACTIVE' });
    const requester = await makeUser();
    const approver = await makeUser();
    const transfer = await requestTransfer(source.id, target.id, requester);

    // No edit path changes a Kind once a Campaign has left Draft
    // (requireKindAndDeadlineEditable); this is the defence behind that rule.
    await prisma.campaign.update({ where: { id: target.id }, data: { kind: 'WAKAF' } });

    await expect(
      transfers.approveCampaignTransfer(prisma, { campaignTransferId: transfer.id, decidedById: approver }),
    ).rejects.toBeInstanceOf(transfers.CampaignTransferCrossKindError);
    expect(await balanceOf(source.id)).toBe(300_000);
    expect(await balanceOf(target.id)).toBe(0);
    expect((await prisma.campaignTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe('PENDING');
  }, 60_000);

  it('a wakaf Category changed after the request (an Admin edit) stops the approval', async () => {
    const source = await makeCampaign({ status: 'SUSPENDED', kind: 'WAKAF', category: 'Wakaf Pendidikan', balance: 300_000 });
    const target = await makeCampaign({ status: 'ACTIVE', kind: 'WAKAF', category: 'Wakaf Pendidikan' });
    const requester = await makeUser();
    const approver = await makeUser();
    const transfer = await requestTransfer(source.id, target.id, requester);

    await prisma.campaign.update({ where: { id: target.id }, data: { category: 'Wakaf Kesehatan' } });

    await expect(
      transfers.approveCampaignTransfer(prisma, { campaignTransferId: transfer.id, decidedById: approver }),
    ).rejects.toBeInstanceOf(transfers.CampaignTransferCategoryMismatchError);
    expect(await balanceOf(source.id)).toBe(300_000);
    expect(await balanceOf(target.id)).toBe(0);
  }, 60_000);
});
