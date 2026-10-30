// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { LedgerSubject } from '@/lib/money/ledger';

/**
 * Finance recap against a REAL Postgres (ticket 79): the recap's totals equal
 * the ledger's own totals, a beta (sandbox) Payment is left out, and a month is
 * a WIB month. Same setup as beta-ledger-mode-real-db.test.ts: a throwaway
 * database migrated by replaying every migration, and a visible skip when
 * TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

const LIVE = { gross: 300_000, providerFee: 15_000, platformFee: 7_500, net: 277_500 } as const;
const BETA = { gross: 500_000, providerFee: 25_000, platformFee: 12_500, net: 462_500 } as const;
const MANUAL = 50_000;
const REFUND_APPROVED = 100_000;
const REFUND_PENDING = 20_000;
const PAYOUT = 120_000;

describe.skipIf(!DATABASE_URL)('Finance recap -- against real Postgres (ticket 79)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[finance recap] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `finance_recap_${process.pid}`;
  let prisma: PrismaClient;
  let ledger: typeof import('@/lib/money/ledger');
  let payouts: typeof import('@/lib/money/payouts');
  let refunds: typeof import('@/lib/money/refunds');
  let escrow: typeof import('@/lib/money/escrow');
  let manual: typeof import('@/lib/money/manual-contributions');
  let recapLib: typeof import('@/lib/money/finance-recap');
  let GET: typeof import('@/app/api/admin/finance/recap/route').GET;
  let session: { user: { id: string; assignments: string[] } } | null;

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
    vi.doMock('@/lib/auth', () => ({ getServerSession: async () => session }));
    vi.doMock('@/lib/payments', () => ({ getPaymentProvider: vi.fn(), getActivePaymentProvider: vi.fn() }));
    ledger = await import('@/lib/money/ledger');
    payouts = await import('@/lib/money/payouts');
    refunds = await import('@/lib/money/refunds');
    escrow = await import('@/lib/money/escrow');
    manual = await import('@/lib/money/manual-contributions');
    recapLib = await import('@/lib/money/finance-recap');
    ({ GET } = await import('@/app/api/admin/finance/recap/route'));
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

  /** Moves every entry of every transaction that touches `campaignId` to `at`. */
  async function moveCampaignEntriesTo(campaignId: string, at: Date) {
    await prisma.$executeRaw`
      UPDATE "LedgerEntry" SET "createdAt" = ${at}
      WHERE "transactionId" IN (SELECT "transactionId" FROM "LedgerEntry" WHERE "campaignId" = ${campaignId})`;
  }

  /**
   * One Campaign of `kind` with a live Payment and a beta Payment, both settled
   * and swept; then a Manual Contribution, one approved and one pending Refund
   * of the live Payment, and one approved Payout.
   */
  async function seedCampaign(kind: 'DONATION' | 'ZAKAT', title: string) {
    const ownerId = await makeUser();
    const campaignId = `campaign-${process.pid}-${next()}`;
    await prisma.campaign.create({
      data: {
        id: campaignId,
        slug: campaignId,
        title,
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 10_000_000,
        category: 'Zakat Maal',
        kind,
        creatorId: ownerId,
        lifecycleStatus: 'ACTIVE',
        collectedAmount: LIVE.gross,
      },
    });
    const subject: LedgerSubject = { type: 'campaign', campaignId };

    async function settle(figures: typeof LIVE | typeof BETA, sandbox: boolean): Promise<string> {
      const donationId = `donation-${process.pid}-${next()}`;
      await prisma.donation.create({
        data: { id: donationId, amount: figures.gross, paymentMethod: 'bank_transfer', campaignId, paymentStatus: 'confirmed' },
      });
      const payment = await prisma.payment.create({
        data: {
          donationId,
          provider: 'sumopod',
          method: 'bank_transfer',
          providerRef: `ref-${process.pid}-${next()}`,
          amount: figures.gross,
          providerFee: figures.providerFee,
          platformFee: figures.platformFee,
          status: 'PAID',
          sandbox,
          escrowReleaseAt: new Date(Date.now() - MS_PER_DAY),
        },
      });
      await prisma.$transaction((tx) =>
        ledger.postTransaction(
          tx,
          ledger.paymentSettledLegs({
            subject,
            grossAmount: figures.gross,
            providerFee: figures.providerFee,
            platformFee: figures.platformFee,
          }),
          { paymentId: payment.id, sandbox, provider: 'sumopod' },
        ),
      );
      return payment.id;
    }

    const live = await settle(LIVE, false);
    await settle(BETA, true);
    const swept = await escrow.releaseMaturedEscrow({ type: 'campaign', id: campaignId });
    expect(swept.releasedCount).toBe(2);

    const recorder = await makeUser();
    const contribution = await prisma.$transaction((tx) =>
      manual.recordManualContribution(tx, {
        target: { campaignId },
        amount: MANUAL,
        proofReference: `MC-${campaignId}`,
        recordedById: recorder,
      }),
    );
    await manual.approveManualContribution(prisma, { manualContributionId: contribution.id, decidedById: await makeUser() });

    for (const amount of [REFUND_APPROVED, REFUND_PENDING]) {
      const requestedById = await makeUser();
      const refund = await prisma.$transaction((tx) =>
        refunds.createRefund(tx, { subject, paymentId: live, amount, reason: refunds.CLOSED_CAMPAIGN_REFUND_REASON, requestedById }),
      );
      if (amount === REFUND_APPROVED) {
        await refunds.approveRefund(prisma, {
          refundId: refund.id,
          approvedById: await makeUser(),
          donorBankCode: 'BCA',
          donorAccountName: 'Donor Uji',
          donorAccountNumber: '1234567890',
        });
      }
    }

    const bankAccount = await prisma.bankAccount.create({
      data: {
        ownerId,
        bankCode: 'BCA',
        accountName: 'Pemilik Uji',
        accountNumberCiphertext: 'ct',
        accountNumberKeyId: 'k',
        verifiedAt: new Date(),
      },
    });
    const draft = await prisma.$transaction((tx) =>
      payouts.requestPayout(tx, { subject, requestedById: ownerId, bankAccountId: bankAccount.id, amount: PAYOUT, description: 'uji' }),
    );
    await payouts.approvePayout(prisma, {
      payoutId: draft.id,
      approvedById: await makeUser(),
      provider: 'sumopod',
      providerBalance: 10_000_000,
    });
    return { campaignId, payoutId: draft.id };
  }

  it('equals the ledger: every column of a Campaign matches what the ledger entries sum to, beta money left out', async () => {
    const a = await seedCampaign('DONATION', 'Campaign A');
    const b = await seedCampaign('ZAKAT', 'Campaign B');
    // 2026-10-15 noon WIB, mid-month so only the totals are on trial here.
    await moveCampaignEntriesTo(a.campaignId, new Date('2026-10-15T05:00:00Z'));
    await moveCampaignEntriesTo(b.campaignId, new Date('2026-10-20T05:00:00Z'));

    const recap = await recapLib.financeRecap(prisma, { from: '2026-10', to: '2026-10' });
    const rowA = recap.rows.find((r) => r.campaignId === a.campaignId)!;
    const rowB = recap.rows.find((r) => r.campaignId === b.campaignId)!;
    expect(rowA).toMatchObject({ period: '2026-10', kind: 'DONATION', campaignTitle: 'Campaign A' });
    expect(rowB).toMatchObject({ period: '2026-10', kind: 'ZAKAT', campaignTitle: 'Campaign B' });

    // Literal expectations: the live Payment only, not the beta one.
    expect(rowA).toMatchObject({
      donasiDiterima: LIVE.gross,
      biayaPenyedia: LIVE.providerFee,
      biayaPlatform: LIVE.platformFee,
      danaBersih: LIVE.net,
      kontribusiManual: MANUAL,
      refundDisetujui: REFUND_APPROVED,
      refundTertahan: REFUND_PENDING,
      payout: PAYOUT,
    });
    // The conservation law of a settlement.
    for (const row of recap.rows) {
      expect(row.donasiDiterima).toBe(row.biayaPenyedia + row.biayaPlatform + row.danaBersih);
    }

    // Independent ledger totals, read straight off LedgerEntry for these Campaigns.
    const ids = [a.campaignId, b.campaignId];
    const sum = async (where: Record<string, unknown>) =>
      (await prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { sandbox: false, ...where } }))._sum.amount ?? 0;
    const txIds = (
      await prisma.ledgerEntry.findMany({ where: { campaignId: { in: ids } }, select: { transactionId: true }, distinct: ['transactionId'] })
    ).map((t) => t.transactionId);
    const inTx = { transactionId: { in: txIds }, refundId: null, payoutId: null, manualContributionId: null };
    const ledgerTotals = {
      donasiDiterima: await sum({ ...inTx, account: 'GATEWAY_CLEARING', direction: 'DEBIT' }),
      biayaPenyedia: await sum({ ...inTx, account: 'PROVIDER_FEE', direction: 'CREDIT' }),
      biayaPlatform: await sum({ ...inTx, account: 'PLATFORM_FEE', direction: 'CREDIT' }),
      danaBersih: await sum({ ...inTx, account: 'ESCROW_HOLD', direction: 'CREDIT' }),
      payout: await sum({ payoutId: { in: [a.payoutId, b.payoutId] }, account: 'PAYOUT_CLEARING', direction: 'CREDIT' }),
    };
    for (const [column, expected] of Object.entries(ledgerTotals)) {
      const total = recap.rows
        .filter((r) => ids.includes(r.campaignId!))
        .reduce((acc, r) => acc + r[column as 'donasiDiterima'], 0);
      expect({ column, total }).toEqual({ column, total: expected });
    }
  }, 120_000);

  it('reads a month as a WIB month: 16:59:59 UTC on the 30th is still September, 17:00:00 UTC is October', async () => {
    const c = await seedCampaign('DONATION', 'Campaign Batas');
    await moveCampaignEntriesTo(c.campaignId, new Date('2026-09-30T16:59:59.999Z'));
    let recap = await recapLib.financeRecap(prisma, { from: '2026-09', to: '2026-09' });
    expect(recap.rows.find((r) => r.campaignId === c.campaignId)?.donasiDiterima).toBe(LIVE.gross);
    recap = await recapLib.financeRecap(prisma, { from: '2026-10', to: '2026-10' });
    expect(recap.rows.find((r) => r.campaignId === c.campaignId)).toBeUndefined();

    await moveCampaignEntriesTo(c.campaignId, new Date('2026-09-30T17:00:00.000Z'));
    recap = await recapLib.financeRecap(prisma, { from: '2026-09', to: '2026-09' });
    expect(recap.rows.find((r) => r.campaignId === c.campaignId)).toBeUndefined();
    recap = await recapLib.financeRecap(prisma, { from: '2026-09', to: '2026-10' });
    expect(recap.rows.find((r) => r.campaignId === c.campaignId)?.period).toBe('2026-10');
  }, 120_000);

  it('serves the same rows as CSV to an Admin and a plain 404 to anyone else', async () => {
    const c = await seedCampaign('DONATION', '=HYPERLINK("http://x")');
    await moveCampaignEntriesTo(c.campaignId, new Date('2026-11-10T05:00:00Z'));
    const req = (qs: string) => new NextRequest(`http://localhost/api/admin/finance/recap?${qs}`);

    session = { user: { id: 'someone', assignments: ['VERIFIER'] } };
    expect((await GET(req('from=2026-11&to=2026-11'))).status).toBe(404);

    session = { user: { id: 'admin', assignments: ['ADMIN'] } };
    const res = await GET(req('from=2026-11&to=2026-11'));
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    const cells = lines[1].split(',');
    expect(cells.slice(-9).map(Number)).toEqual([
      LIVE.gross, LIVE.providerFee, LIVE.platformFee, LIVE.net, MANUAL, REFUND_APPROVED, REFUND_PENDING, expect.any(Number), PAYOUT,
    ]);
    expect(lines[2].split(',')[0]).toBe('Total');
  }, 120_000);
});
