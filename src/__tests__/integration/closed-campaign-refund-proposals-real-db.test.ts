// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Refund proposals for a closed Campaign, against a REAL Postgres
 * (tickets audit-2026-10-16/07 and rilis-1-benda/80; owner decision
 * 2026-10-16, "Sesuai PRD").
 *
 * What a mock cannot show: that "money not left" is read off the ledger the
 * money layer really posts, that the freeze of one proposal shrinks the budget
 * of the next, that a second click proposes nothing, and that two clicks at
 * once on the worklist make one Refund. Same setup as
 * beta-ledger-mode-real-db.test.ts: a throwaway database migrated by replaying
 * every migration, and a visible skip when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const DAY = 24 * 60 * 60 * 1000;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('Closed-Campaign Refund proposals -- against real Postgres', () => {
  if (!DATABASE_URL) {
    console.warn('[closed-campaign refunds] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `closed_refunds_${process.pid}`;
  let prisma: PrismaClient;
  let ledger: typeof import('@/lib/money/ledger');
  let escrow: typeof import('@/lib/money/escrow');
  let proposals: typeof import('@/lib/money/campaign-refund-proposals');

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
    escrow = await import('@/lib/money/escrow');
    proposals = await import('@/lib/money/campaign-refund-proposals');
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

  type Opts = {
    status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'COMPLETED' | 'EXPIRED';
    kind?: 'DONATION' | 'WAKAF';
    deadline?: Date | null;
    closedAt?: Date | null;
  };

  async function seedCampaign(opts: Opts) {
    const ownerId = await makeUser();
    const campaignId = `campaign-${process.pid}-${next()}`;
    await prisma.campaign.create({
      data: {
        id: campaignId,
        slug: campaignId,
        title: `Campaign ${campaignId}`,
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 10_000_000,
        category: 'Zakat Maal',
        kind: opts.kind ?? 'DONATION',
        creatorId: ownerId,
        lifecycleStatus: opts.status,
        deadline: opts.deadline === undefined ? null : opts.deadline,
      },
    });
    if (opts.closedAt && opts.status !== 'ACTIVE') {
      await prisma.campaignStatusChange.create({
        data: {
          campaignId,
          action: opts.status === 'CANCELLED' ? 'CANCELLED' : opts.status === 'COMPLETED' ? 'COMPLETED' : 'SUSPENDED',
          fromStatus: 'ACTIVE',
          toStatus: opts.status,
          capacity: 'SYSTEM',
          createdAt: opts.closedAt,
        },
      });
    }
    return campaignId;
  }

  const feesOf = (gross: number) => ({ providerFee: Math.round(gross * 0.05), platformFee: Math.round(gross * 0.025) });
  const netOf = (gross: number) => gross - feesOf(gross).providerFee - feesOf(gross).platformFee;

  /** A Donation Payment, settled `settledDaysAgo` days ago, with the journal the webhook posts. */
  async function settle(
    campaignId: string,
    gross: number,
    o: { settledDaysAgo: number; released?: boolean; sandbox?: boolean; status?: 'PAID' | 'PENDING' } = { settledDaysAgo: 1 },
  ): Promise<string> {
    const status = o.status ?? 'PAID';
    const donationId = `donation-${process.pid}-${next()}`;
    await prisma.donation.create({
      data: { id: donationId, amount: gross, paymentMethod: 'bank_transfer', campaignId, paymentStatus: 'confirmed' },
    });
    const fees = feesOf(gross);
    const settledAt = new Date(Date.now() - o.settledDaysAgo * DAY);
    const payment = await prisma.payment.create({
      data: {
        donationId,
        provider: 'sumopod',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: gross,
        ...fees,
        status,
        sandbox: o.sandbox ?? false,
        ...(status === 'PAID'
          ? { settledAt, paidAt: settledAt, escrowReleaseAt: o.released ? new Date(Date.now() - DAY) : new Date(Date.now() + 5 * DAY) }
          : {}),
      },
    });
    if (status === 'PAID') {
      await prisma.$transaction((tx) =>
        ledger.postTransaction(
          tx,
          ledger.paymentSettledLegs({ subject: { type: 'campaign', campaignId }, grossAmount: gross, ...fees }),
          { paymentId: payment.id, sandbox: o.sandbox ?? false, provider: 'sumopod' },
        ),
      );
    }
    return payment.id;
  }

  const release = (campaignId: string) => escrow.releaseMaturedEscrow({ type: 'campaign', id: campaignId });
  const standing = (paymentId: string) => prisma.refund.findMany({ where: { paymentId } });

  describe('proposeCampaignRefunds', () => {
    it('proposes for money still in escrow and for released money the balance still covers (newest first), reports the rest as paid out, and is idempotent', async () => {
      // Open while the escrow sweep runs (it does not release a Suspended Campaign's escrow), then Suspended.
      const campaignId = await seedCampaign({ status: 'ACTIVE' });
      const admin = await makeUser();

      const held = await settle(campaignId, 100_000, { settledDaysAgo: 1 });
      const oldReleased = await settle(campaignId, 200_000, { settledDaysAgo: 10, released: true });
      const newReleased = await settle(campaignId, 300_000, { settledDaysAgo: 5, released: true });
      const beta = await settle(campaignId, 50_000, { settledDaysAgo: 1, sandbox: true });
      const unpaid = await settle(campaignId, 70_000, { settledDaysAgo: 1, status: 'PENDING' });
      await release(campaignId);
      await prisma.campaign.update({ where: { id: campaignId }, data: { lifecycleStatus: 'SUSPENDED' } });
      await prisma.campaignStatusChange.create({
        data: {
          campaignId,
          action: 'SUSPENDED',
          fromStatus: 'ACTIVE',
          toStatus: 'SUSPENDED',
          capacity: 'SYSTEM',
          createdAt: new Date(Date.now() - 2 * DAY),
        },
      });

      // A Payout instructed the oldest money out: only the newer Payment's net is left.
      await prisma.$transaction((tx) =>
        ledger.postTransaction(tx, ledger.payoutInstructedLegs({ subject: { type: 'campaign', campaignId }, amount: netOf(200_000) })),
      );

      const first = await proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: admin });

      expect(first.created.map((c) => c.paymentId).sort()).toEqual([held, newReleased].sort());
      expect(first.created.every((c) => c.amount === (c.paymentId === held ? 100_000 : 300_000))).toBe(true);
      expect(first.skipped).toContainEqual({ paymentId: oldReleased, amount: 200_000, reason: 'sudahKeluar' });
      expect(first.skipped).toContainEqual({ paymentId: beta, amount: 50_000, reason: 'modeBerbeda' });
      expect(first.paidOut).toEqual({ count: 1, amount: 200_000 });
      expect(first.alreadyProposed).toBe(0);

      for (const paymentId of [held, newReleased]) {
        const [refund] = await standing(paymentId);
        expect(refund).toMatchObject({ status: 'REQUESTED', requestedById: admin });
        expect(refund.reason).toMatch(/^Usulan penutupan Campaign/);
      }
      expect(await standing(oldReleased)).toHaveLength(0);
      expect(await standing(unpaid)).toHaveLength(0);
      expect(await standing(beta)).toHaveLength(0);

      // The frozen money no longer counts as available: nothing was over-promised.
      const balance = await prisma.$transaction((tx) => ledger.campaignBalance(tx, campaignId, false));
      expect(balance).toBe(0);

      const second = await proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: admin });
      expect(second.created).toEqual([]);
      expect(second.alreadyProposed).toBe(2);
      expect(await prisma.refund.count({ where: { payment: { donation: { campaignId } } } })).toBe(2);
    });

    it('refuses a Campaign that is not Suspended or Cancelled', async () => {
      const campaignId = await seedCampaign({ status: 'ACTIVE' });
      await settle(campaignId, 100_000, { settledDaysAgo: 1 });
      await expect(
        proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: await makeUser() }),
      ).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_CLOSED_FOR_REFUND_PROPOSAL' });
      expect(await prisma.refund.count({ where: { payment: { donation: { campaignId } } } })).toBe(0);
    });

    it('re-proposes a Payment whose Refund was rejected, but not one whose Refund stands', async () => {
      const campaignId = await seedCampaign({ status: 'CANCELLED', closedAt: new Date(Date.now() - DAY) });
      const admin = await makeUser();
      const paymentId = await settle(campaignId, 100_000, { settledDaysAgo: 3 });
      await proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: admin });
      const [refund] = await standing(paymentId);
      await prisma.refund.update({ where: { id: refund.id }, data: { status: 'REJECTED' } });

      const again = await proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: admin });
      expect(again.created.map((c) => c.paymentId)).toEqual([paymentId]);
    });

    it('restricted Kind: allowed phrase only for money that came in after the closure; the rest is reported, not forced', async () => {
      const campaignId = await seedCampaign({ status: 'SUSPENDED', kind: 'WAKAF', closedAt: new Date(Date.now() - 4 * DAY) });
      const admin = await makeUser();
      const before = await settle(campaignId, 100_000, { settledDaysAgo: 8 });
      const after = await settle(campaignId, 120_000, { settledDaysAgo: 1 });

      const result = await proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: admin });

      expect(result.created.map((c) => c.paymentId)).toEqual([after]);
      expect(result.skipped).toContainEqual({ paymentId: before, amount: 100_000, reason: 'kindTerbatas' });
      expect((await standing(after))[0].reason).toBe('dana masuk setelah Campaign ditutup');
    });
  });

  describe('proposeCampaignRefunds: failure, race and skip reasons', () => {
    it('two bulk runs at once make exactly one Refund per Payment', async () => {
      const campaignId = await seedCampaign({ status: 'CANCELLED', closedAt: new Date(Date.now() - DAY) });
      const admin = await makeUser();
      const other = await makeUser();
      const ids = [
        await settle(campaignId, 100_000, { settledDaysAgo: 3 }),
        await settle(campaignId, 110_000, { settledDaysAgo: 3 }),
        await settle(campaignId, 120_000, { settledDaysAgo: 3 }),
      ];

      const [a, b] = await Promise.all([
        proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: admin }),
        proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: other }),
      ]);

      expect(a.created.length + b.created.length).toBe(3);
      expect(a.gagal).toEqual([]);
      expect(b.gagal).toEqual([]);
      for (const id of ids) expect(await standing(id)).toHaveLength(1);
    });

    it('skips an anonymised Donation (anonim) and money a Campaign Transfer moved away (dipindahkan)', async () => {
      const campaignId = await seedCampaign({ status: 'ACTIVE' });
      const target = await seedCampaign({ status: 'ACTIVE' });
      const admin = await makeUser();
      const anonymised = await settle(campaignId, 100_000, { settledDaysAgo: 3 });
      const moved = await settle(campaignId, 200_000, { settledDaysAgo: 3, released: true });
      await release(campaignId);
      await prisma.donation.updateMany({ where: { payments: { some: { id: anonymised } } }, data: { anonymisedAt: new Date() } });
      // The whole released balance was transferred to another Campaign.
      await prisma.campaignTransfer.create({
        data: { sourceId: campaignId, targetId: target, amount: netOf(200_000), reason: 'x', status: 'APPROVED', requestedById: admin },
      });
      await prisma.$transaction((tx) =>
        ledger.postTransaction(tx, ledger.payoutInstructedLegs({ subject: { type: 'campaign', campaignId }, amount: netOf(200_000) })),
      );
      await prisma.campaign.update({ where: { id: campaignId }, data: { lifecycleStatus: 'SUSPENDED' } });

      const result = await proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: admin });

      expect(result.created).toEqual([]);
      expect(result.skipped).toContainEqual({ paymentId: anonymised, amount: 100_000, reason: 'anonim' });
      expect(result.skipped).toContainEqual({ paymentId: moved, amount: 200_000, reason: 'dipindahkan' });
      expect(result.paidOut).toEqual({ count: 0, amount: 0 });
    });

    it('an Admin who owns the Campaign lands every Payment in gagal and the run still ends normally', async () => {
      const campaignId = await seedCampaign({ status: 'SUSPENDED', closedAt: new Date(Date.now() - DAY) });
      const { creatorId } = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { creatorId: true } });
      const a = await settle(campaignId, 100_000, { settledDaysAgo: 3 });
      const b = await settle(campaignId, 110_000, { settledDaysAgo: 3 });

      const result = await proposals.proposeCampaignRefunds(prisma, { campaignId, actorAdminId: creatorId });

      expect(result.created).toEqual([]);
      expect(result.gagal.map((g) => g.paymentId).sort()).toEqual([a, b].sort());
      expect(result.gagal[0].error).toBeTruthy();
      expect(await prisma.refund.count({ where: { paymentId: { in: [a, b] } } })).toBe(0);
    });
  });

  describe('late-settlement worklist', () => {
    it('lists Payments that settled after their Campaign closed, in every closed status, and nothing else', async () => {
      const admin = await makeUser();
      const suspended = await seedCampaign({ status: 'SUSPENDED', closedAt: new Date(Date.now() - 5 * DAY) });
      const completed = await seedCampaign({ status: 'COMPLETED', closedAt: new Date(Date.now() - 5 * DAY) });
      const cancelled = await seedCampaign({ status: 'CANCELLED', closedAt: new Date(Date.now() - 5 * DAY) });
      // Expired by deadline, never recorded in the log: the deadline is the closure.
      const expired = await seedCampaign({ status: 'ACTIVE', deadline: new Date(Date.now() - 5 * DAY) });
      // ADR 0021: a Payment paid late on an OPEN Campaign is a Settlement, never listed.
      const open = await seedCampaign({ status: 'ACTIVE', deadline: new Date(Date.now() + 30 * DAY) });

      const lateSuspended = await settle(suspended, 100_000, { settledDaysAgo: 1 });
      const earlySuspended = await settle(suspended, 100_000, { settledDaysAgo: 9 });
      const lateCompleted = await settle(completed, 110_000, { settledDaysAgo: 2 });
      const lateCancelled = await settle(cancelled, 120_000, { settledDaysAgo: 2 });
      const lateExpired = await settle(expired, 130_000, { settledDaysAgo: 1 });
      const earlyExpired = await settle(expired, 130_000, { settledDaysAgo: 8 });
      const onOpen = await settle(open, 140_000, { settledDaysAgo: 1 });
      const pending = await settle(suspended, 150_000, { settledDaysAgo: 1, status: 'PENDING' });
      const sandbox = await settle(suspended, 160_000, { settledDaysAgo: 1, sandbox: true });

      // A Refund that stands takes the Payment off the list; a rejected one puts it back.
      const refunded = await settle(suspended, 170_000, { settledDaysAgo: 1 });
      const rejected = await settle(suspended, 180_000, { settledDaysAgo: 1 });
      for (const [paymentId, status] of [[refunded, 'REQUESTED'], [rejected, 'REJECTED']] as const) {
        await prisma.refund.create({ data: { paymentId, amount: 1, reason: 'x', status, requestedById: admin } });
      }

      const rows = await proposals.lateSettlementWorklist(prisma);
      const ids = rows.map((r) => r.paymentId);

      for (const id of [lateSuspended, lateCompleted, lateCancelled, lateExpired, rejected]) expect(ids).toContain(id);
      for (const id of [earlySuspended, earlyExpired, onOpen, pending, sandbox, refunded]) expect(ids).not.toContain(id);
      const row = rows.find((r) => r.paymentId === lateCompleted)!;
      expect(row).toMatchObject({ amount: 110_000, campaign: { id: completed, status: 'COMPLETED' } });
    });

    it('proposeLateSettlementRefund: full Gross, the clicking Admin as requester, refused the second time, one Refund under a double click', async () => {
      const admin = await makeUser();
      const campaignId = await seedCampaign({ status: 'COMPLETED', closedAt: new Date(Date.now() - 5 * DAY) });
      const paymentId = await settle(campaignId, 100_000, { settledDaysAgo: 1 });

      const refund = await proposals.proposeLateSettlementRefund(prisma, { paymentId, actorAdminId: admin });
      expect(refund).toMatchObject({ amount: 100_000, status: 'REQUESTED', requestedById: admin, reason: 'dana masuk setelah Campaign ditutup' });
      await expect(proposals.proposeLateSettlementRefund(prisma, { paymentId, actorAdminId: admin })).rejects.toMatchObject({
        code: 'LATE_SETTLEMENT_NOT_PROPOSABLE',
      });

      const racing = await settle(campaignId, 90_000, { settledDaysAgo: 1 });
      const settled = await Promise.allSettled([
        proposals.proposeLateSettlementRefund(prisma, { paymentId: racing, actorAdminId: admin }),
        proposals.proposeLateSettlementRefund(prisma, { paymentId: racing, actorAdminId: admin }),
      ]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      expect(await standing(racing)).toHaveLength(1);
      // Gone from the list once proposed.
      expect((await proposals.lateSettlementWorklist(prisma)).map((r) => r.paymentId)).not.toContain(racing);
    });

    it('refuses a Payment that is not on the worklist', async () => {
      const campaignId = await seedCampaign({ status: 'SUSPENDED', closedAt: new Date(Date.now() - 5 * DAY) });
      const early = await settle(campaignId, 100_000, { settledDaysAgo: 9 });
      await expect(
        proposals.proposeLateSettlementRefund(prisma, { paymentId: early, actorAdminId: await makeUser() }),
      ).rejects.toMatchObject({ code: 'LATE_SETTLEMENT_NOT_PROPOSABLE' });
    });
  });
});
