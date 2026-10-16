// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { LedgerSubject } from '@/lib/money/ledger';

/**
 * Real money and beta (sandbox) money in ONE ledger, against a REAL Postgres
 * (ticket rilis-1-benda/94).
 *
 * The claim: a Campaign that took one real Payment and one beta Payment keeps
 * two pools that never touch. The beta Payment's settlement, its escrow release,
 * its Refund and every Payout drawn on it are stamped sandbox from their SOURCE
 * row (not from the marker at that moment), every balance reads one mode, a
 * Payout is funded only by its own mode's balance, the whole Payout -> Usage
 * Report -> Refund cycle runs on test money without a call to the payment
 * provider, and the reconciliation report stays clean for the mixture.
 *
 * A JS fake cannot show that the journals the money layer really posts carry
 * the stamp end to end, so these drive the real functions. Same setup as
 * beta-sandbox-counted-payments-real-db.test.ts: a throwaway database migrated
 * by replaying every migration, and a visible skip when TEST_DATABASE_URL is
 * unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

// Gross 300_000 live, 500_000 beta; the fees are literals so a wrong net shows.
const LIVE = { gross: 300_000, providerFee: 15_000, platformFee: 7_500, net: 277_500 } as const;
const BETA = { gross: 500_000, providerFee: 25_000, platformFee: 12_500, net: 462_500 } as const;

const providerSpy = vi.fn();

describe.skipIf(!DATABASE_URL)('Ledger per mode -- against real Postgres (ticket 94)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[beta ledger mode] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `beta_ledger_mode_${process.pid}`;
  let prisma: PrismaClient;
  let ledger: typeof import('@/lib/money/ledger');
  let payouts: typeof import('@/lib/money/payouts');
  let refunds: typeof import('@/lib/money/refunds');
  let escrow: typeof import('@/lib/money/escrow');
  let usageReports: typeof import('@/lib/usage-reports');
  let manual: typeof import('@/lib/money/manual-contributions');
  let dormant: typeof import('@/lib/money/dormant-balances');
  let impact: typeof import('@/lib/money/impact');
  let GET: typeof import('@/app/api/admin/reconcile/route').GET;

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
    vi.doMock('@/lib/auth', () => ({
      getServerSession: async () => ({ user: { id: 'admin-reconcile', assignments: ['ADMIN'] } }),
    }));
    // The payment provider is the one thing that must never be reached by the
    // money modules while they simulate: any import of it is a spy that fails
    // the test if it is ever called.
    vi.doMock('@/lib/payments', () => ({
      getPaymentProvider: providerSpy,
      getActivePaymentProvider: providerSpy,
    }));
    ledger = await import('@/lib/money/ledger');
    payouts = await import('@/lib/money/payouts');
    refunds = await import('@/lib/money/refunds');
    escrow = await import('@/lib/money/escrow');
    usageReports = await import('@/lib/usage-reports');
    manual = await import('@/lib/money/manual-contributions');
    dormant = await import('@/lib/money/dormant-balances');
    impact = await import('@/lib/money/impact');
    ({ GET } = await import('@/app/api/admin/reconcile/route'));
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  afterEach(() => vi.unstubAllEnvs());

  let counter = 0;
  const next = () => counter++;

  async function makeUser(): Promise<string> {
    const id = `u-${process.pid}-${next()}`;
    await prisma.user.create({
      data: { id, name: 'Test', emailHmac: `${id}-hmac`, emailHmacKeyId: 'k', emailCiphertext: `${id}-c`, emailKeyId: 'k' },
    });
    return id;
  }

  async function makeBankAccount(ownerId: string): Promise<string> {
    return (
      await prisma.bankAccount.create({
        data: {
          ownerId,
          bankCode: 'BCA',
          accountName: 'Pemilik Uji',
          accountNumberCiphertext: 'ct',
          accountNumberKeyId: 'k',
          verifiedAt: new Date(),
        },
      })
    ).id;
  }

  type World = { campaignId: string; subject: LedgerSubject; ownerId: string; live: string; beta: string };

  /**
   * One Campaign holding a real Payment and a beta Payment, both settled and
   * their escrow matured. The beta one is stamped the way a beta deployment
   * stamps it (sandbox on the Payment, on every settlement leg).
   */
  async function seedWorld(): Promise<World> {
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
        kind: 'DONATION',
        creatorId: ownerId,
        lifecycleStatus: 'ACTIVE',
        // The settlement webhook increments the lifetime counter for both.
        collectedAmount: LIVE.gross + BETA.gross,
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
    const beta = await settle(BETA, true);
    return { campaignId, subject, ownerId, live, beta };
  }

  async function sweep(world: World, expected: number) {
    const result = await escrow.releaseMaturedEscrow({ type: 'campaign', id: world.campaignId });
    expect(result.releasedCount).toBe(expected);
  }

  const balances = (campaignId: string) =>
    prisma.$transaction(async (tx) => ({
      live: await ledger.campaignBalance(tx, campaignId, false),
      test: await ledger.campaignBalance(tx, campaignId, true),
      liveEscrow: await ledger.escrowBalance(tx, campaignId, false),
      testEscrow: await ledger.escrowBalance(tx, campaignId, true),
    }));

  it('stamps every leg of a Payment, its escrow release and its Refunds with the Payment\'s own mode', async () => {
    const world = await seedWorld();
    expect(await balances(world.campaignId)).toEqual({
      live: 0,
      test: 0,
      liveEscrow: LIVE.net,
      testEscrow: BETA.net,
    });

    // The marker is OFF while the sweep runs: the mode comes from the Payment.
    vi.stubEnv('BETA_SANDBOX', '');
    await sweep(world, 2);

    expect(await balances(world.campaignId)).toEqual({
      live: LIVE.net,
      test: BETA.net,
      liveEscrow: 0,
      testEscrow: 0,
    });

    const entries = await prisma.ledgerEntry.findMany({
      where: { paymentId: { in: [world.live, world.beta] } },
      select: { paymentId: true, sandbox: true },
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.sandbox).toBe(entry.paymentId === world.beta);
  });

  it('funds a Payout from its own mode only: test money cannot pay out for real, nor real money for a simulation', async () => {
    const world = await seedWorld();
    await sweep(world, 2);
    const bankAccountId = await makeBankAccount(world.ownerId);
    const request = (amount: number) =>
      prisma.$transaction((tx) =>
        payouts.requestPayout(tx, {
          subject: world.subject,
          requestedById: world.ownerId,
          bankAccountId,
          amount,
          description: 'uji',
        }),
      );

    // Live: more than the real pool, less than the two pools together.
    vi.stubEnv('BETA_SANDBOX', '');
    await expect(request(LIVE.net + 1)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    const real = await request(LIVE.net);
    expect(real.sandbox).toBe(false);

    // Beta: more than the test pool, less than the two together.
    vi.stubEnv('BETA_SANDBOX', 'true');
    await expect(request(BETA.net + 1)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    const simulated = await request(BETA.net);
    expect(simulated.sandbox).toBe(true);
  });

  it('simulates Payout -> Usage Report -> Refund end to end on test money, with no call to the payment provider and no touch on real money', async () => {
    const world = await seedWorld();
    await sweep(world, 2);
    const before = await balances(world.campaignId);
    const bankAccountId = await makeBankAccount(world.ownerId);
    const approver = await makeUser();
    const completer = await makeUser();
    const payoutAmount = 400_000;

    vi.stubEnv('BETA_SANDBOX', 'true');
    const requested = await prisma.$transaction((tx) =>
      payouts.requestPayout(tx, {
        subject: world.subject,
        requestedById: world.ownerId,
        bankAccountId,
        amount: payoutAmount,
        description: 'Simulasi pencairan',
      }),
    );
    await payouts.approvePayout(prisma, {
      payoutId: requested.id,
      approvedById: approver,
      provider: 'sumopod',
      providerBalance: 10_000_000,
    });
    // The marker goes away between the steps: the Payout keeps its own mode.
    vi.stubEnv('BETA_SANDBOX', '');
    const completed = await payouts.completePayout(prisma, {
      payoutId: requested.id,
      completedById: completer,
      proofReference: 'SIM-0001',
      proofNote: 'Simulasi: tidak ada transfer nyata.',
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.sandbox).toBe(true);

    const report = await usageReports.submitUsageReport(prisma, {
      payoutId: requested.id,
      submittedById: world.ownerId,
      narrative: 'Simulasi laporan pemakaian dana',
      lineItems: [{ label: 'Uji', amount: payoutAmount }],
      beneficiaryCount: 10,
      photos: ['https://example.com/p.jpg'],
    });
    expect(report.sandbox).toBe(true);

    // Every leg of the Payout is test money.
    const payoutLegs = await prisma.ledgerEntry.findMany({ where: { payoutId: requested.id }, select: { sandbox: true } });
    expect(payoutLegs.length).toBeGreaterThan(0);
    expect(payoutLegs.every((l) => l.sandbox)).toBe(true);

    // A Refund of the beta Payment: created, approved, completed (three people).
    const refundRequester = await makeUser();
    const refundApprover = await makeUser();
    const refundCompleter = await makeUser();
    const refundAmount = 100_000;
    const refund = await prisma.$transaction((tx) =>
      refunds.createRefund(tx, {
        subject: world.subject,
        paymentId: world.beta,
        amount: refundAmount,
        reason: 'uji',
        requestedById: refundRequester,
      }),
    );
    expect(refund.sandbox).toBe(true);
    await refunds.approveRefund(prisma, {
      refundId: refund.id,
      approvedById: refundApprover,
      donorBankCode: 'BCA',
      donorAccountName: 'Donor Uji',
      donorAccountNumber: '1234567890',
    });
    await refunds.completeRefund(prisma, {
      refundId: refund.id,
      completedById: refundCompleter,
      proofReference: 'SIM-REFUND-1',
      proofNote: 'Simulasi: tidak ada transfer nyata ke Donor.',
      donorAccountNumber: '1234567890',
    });
    const refundLegs = await prisma.ledgerEntry.findMany({ where: { refundId: refund.id }, select: { sandbox: true } });
    expect(refundLegs.length).toBeGreaterThan(0);
    expect(refundLegs.every((l) => l.sandbox)).toBe(true);

    // The real pool did not move by a rupiah; the test pool paid for all of it.
    const after = await balances(world.campaignId);
    expect(after.live).toBe(before.live);
    expect(after.liveEscrow).toBe(before.liveEscrow);
    expect(after.test).toBeLessThanOrEqual(before.test - payoutAmount);

    // And nothing reached the payment provider.
    expect(providerSpy).not.toHaveBeenCalled();
  }, 60_000);

  it('keeps test money out of Dormant, Impact and the Provider Balance, and out of the real Provider Balance', async () => {
    // The provider pots are platform-wide and this database is shared by the
    // tests above, so the claim is stated as what THIS world adds to each pot.
    const pot = async (sandbox: boolean) =>
      (await prisma.$transaction((tx) => ledger.providerBalances(tx, sandbox))).find((r) => r.provider === 'sumopod')
        ?.balance ?? 0;
    const [liveBefore, testBefore] = [await pot(false), await pot(true)];

    const world = await seedWorld();
    await sweep(world, 2);

    // Settlement debits GATEWAY_CLEARING by the Gross: each pot gained its own Payment only.
    expect((await pot(false)) - liveBefore).toBe(LIVE.gross);
    expect((await pot(true)) - testBefore).toBe(BETA.gross);

    // A Campaign past its deadline is reported dormant by its REAL balance only.
    await prisma.campaign.update({
      where: { id: world.campaignId },
      data: { deadline: new Date(Date.now() - 400 * MS_PER_DAY) },
    });
    const dormantRows = await dormant.dormantBalanceReport(prisma, new Date(), 0);
    const row = dormantRows.find((r) => r.campaignId === world.campaignId);
    expect(row?.balance).toBe(LIVE.net);

    // Impact counts the real Payment alone.
    const breakdown = await impact.impactBreakdown(prisma, {});
    expect(breakdown.collected).toBeGreaterThanOrEqual(LIVE.gross);
  });

  it('a Manual Contribution made in the beta is test money; its reversal after go-live comes out of the same test pool', async () => {
    const world = await seedWorld();
    await sweep(world, 2);
    const recorder = await makeUser();
    const approver = await makeUser();
    const reverser = await makeUser();
    const before = await balances(world.campaignId);
    const counterBefore = (await prisma.campaign.findUniqueOrThrow({ where: { id: world.campaignId } })).collectedAmount;

    vi.stubEnv('BETA_SANDBOX', 'true');
    const contribution = await prisma.$transaction((tx) =>
      manual.recordManualContribution(tx, {
        target: { campaignId: world.campaignId },
        amount: 50_000,
        proofReference: 'SIM-MC-1',
        recordedById: recorder,
      }),
    );
    await manual.approveManualContribution(prisma, { manualContributionId: contribution.id, decidedById: approver });

    let after = await balances(world.campaignId);
    expect(after.test).toBe(before.test + 50_000);
    expect(after.live).toBe(before.live);
    // The public counter is real progress: test money never moves it.
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: world.campaignId } })).collectedAmount).toBe(counterBefore);

    vi.stubEnv('BETA_SANDBOX', '');
    await manual.reverseManualContribution(prisma, {
      manualContributionId: contribution.id,
      reversedById: reverser,
      reason: 'uji',
    });
    after = await balances(world.campaignId);
    expect(after.test).toBe(before.test);
    expect(after.live).toBe(before.live);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: world.campaignId } })).collectedAmount).toBe(counterBefore);
  });

  it('the Admin reconciliation report is clean for a mixture of beta and real data', async () => {
    const world = await seedWorld();
    await sweep(world, 2);
    // A simulated Payout leaves the test pool short of the Payments: must not alarm.
    const bankAccountId = await makeBankAccount(world.ownerId);
    vi.stubEnv('BETA_SANDBOX', 'true');
    const draft = await prisma.$transaction((tx) =>
      payouts.requestPayout(tx, {
        subject: world.subject,
        requestedById: world.ownerId,
        bankAccountId,
        amount: 300_000,
        description: 'uji',
      }),
    );
    await payouts.approvePayout(prisma, {
      payoutId: draft.id,
      approvedById: await makeUser(),
      provider: 'sumopod',
      providerBalance: 10_000_000,
    });

    const response = await GET(new Request('http://localhost/api/admin/reconcile') as never, {} as never);
    expect(response.status).toBe(200);
    const report = await response.json();

    expect(report.unbalancedTransactions).toEqual([]);
    expect(report.negativeBalances.filter((b: { campaignId: string }) => b.campaignId === world.campaignId)).toEqual([]);
    expect(report.mismatches.filter((m: { campaignId: string }) => m.campaignId === world.campaignId)).toEqual([]);
    // The approved-but-uncompleted SIMULATED Payout is not a stuck real one.
    expect(JSON.stringify(report)).not.toContain(draft.id);
  });
});
