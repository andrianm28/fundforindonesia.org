// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Ticket 15, round 3: proves the `escrowSweepDeferredAt` rotation against a
 * REAL Postgres, not the JS mock `escrow.test.ts` uses for everything else.
 *
 * Why this exists on top of that file: the mock reimplements
 * `orderBy: [{ escrowSweepDeferredAt: { sort: 'asc', nulls: 'first' } }, ...]`
 * by hand over an in-memory array, which is an approximation of Prisma's
 * actual ORDER-BY-NULLS SQL semantics, not a test that Postgres agrees with
 * it. A round-1 draft of this fix ALSO added `cursor`/`skip: 1` paging on top
 * of that ordering, which independent review flagged as a real hazard the
 * mock could not have caught (a NULL-vs-value comparison at a page boundary
 * can skip or repeat rows under Prisma's cursor semantics) -- releasing that
 * paging (see releaseMaturedEscrow's own doc comment, ./src/lib/money/
 * escrow.ts) is what this test's existence is a condition of, not merely a
 * nice-to-have.
 *
 * Needs a Postgres it may create and drop whole databases in, named by
 * TEST_DATABASE_URL (see .github/workflows/ci.yml's `test` job, which is the
 * job with a Postgres service and `npx vitest run`; ci/local.sh's
 * `local_database` helper sets the same variable locally). Without one every
 * test here is skipped and says so -- the same honest-skip pattern
 * src/lib/drop-migration-guard.test.ts and
 * src/__tests__/ledger-transaction-claim-migration.test.ts already use, and
 * for the same reason: a green test that never opened a connection is worse
 * than a visible skip.
 *
 * Deliberately NOT `src/__tests__/integration/donation-flow.test.ts`'s own
 * pattern -- that file mocks `@/lib/prisma` wholesale and never opens a real
 * connection at all, so despite living in the same directory it is not an
 * example of "how to get a DB and skip when none is available". The two
 * files this one's setup actually follows are named above.
 *
 * SETUP. A throwaway database (not merely a schema) is created per run,
 * migrated by replaying EVERY file under prisma/migrations in order via a
 * raw `pg` client -- the full schema, not a hand-picked subset, because the
 * sweep's query joins Payment through Donation/Campaign and Registration/
 * Batch/VolunteerTrip and this test needs all of it. `@/lib/prisma` is then
 * mocked, via `vi.doMock` + a dynamic `import()` (both AFTER the database
 * exists and is migrated), to hand back a real PrismaClient pointed at that
 * database -- so `releaseMaturedEscrow` runs entirely unmodified, issuing
 * real SQL against real Postgres, and the only thing this file fakes is
 * which connection string `@/lib/prisma` resolves to.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => !d.startsWith('migration_lock'))
    .sort();
}

function migrationSql(dir: string): string {
  return readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
}

function databaseUrlFor(database: string): string {
  // Prisma's own `?schema=` parameter is not one `pg` understands, and the
  // scratch database is a plain one, so every query parameter is dropped --
  // same helper shape as ledger-transaction-claim-migration.test.ts's own
  // databaseUrlFor.
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('releaseMaturedEscrow -- rotation against real Postgres (ticket 15)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[escrow sweep rotation] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `escrow_sweep_rotation_${process.pid}`;
  let prisma: PrismaClient;
  let releaseMaturedEscrow: typeof import('@/lib/money/escrow').releaseMaturedEscrow;

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
      for (const dir of migrationDirs()) {
        await migrator.query(migrationSql(dir));
      }
    } finally {
      await migrator.end();
    }

    const adapter = new PrismaPg({ connectionString: url });
    const { PrismaClient: RealPrismaClient } = await import('@/generated/prisma/client');
    prisma = new RealPrismaClient({ adapter });

    // AFTER the database exists and is migrated, and before the first
    // (dynamic) import of anything that resolves '@/lib/prisma' -- this file
    // never imports '@/lib/money/escrow' or '@/lib/prisma' statically, for
    // exactly this reason.
    vi.doMock('@/lib/prisma', () => ({ prisma }));
    ({ releaseMaturedEscrow } = await import('@/lib/money/escrow'));
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    // WITH (FORCE) closes any session this test left behind, which a plain
    // DROP DATABASE refuses to do.
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  let userCounter = 0;
  async function makeUser(): Promise<string> {
    const id = `user-${process.pid}-${userCounter++}`;
    await prisma.user.create({
      data: {
        id,
        name: 'Test Fundraiser',
        emailHmac: `${id}-hmac`,
        emailHmacKeyId: 'test-key',
        emailCiphertext: `${id}-cipher`,
        emailKeyId: 'test-key',
      },
    });
    return id;
  }

  let campaignCounter = 0;
  async function makeCampaign(creatorId: string, lifecycleStatus: 'ACTIVE' | 'SUSPENDED'): Promise<string> {
    const id = `campaign-${process.pid}-${campaignCounter++}`;
    await prisma.campaign.create({
      data: {
        id,
        slug: id,
        title: 'Test Campaign',
        description: 'Test',
        story: 'Test',
        coverImage: 'https://example.com/cover.jpg',
        targetAmount: 10_000_000,
        category: 'test',
        creatorId,
        lifecycleStatus,
      },
    });
    return id;
  }

  let paymentCounter = 0;
  /** A matured, unreleased, PAID Payment on a fresh Donation under `campaignId`. */
  async function makeMaturedPayment(campaignId: string, escrowReleaseAt: Date): Promise<string> {
    const n = paymentCounter++;
    const donationId = `donation-${process.pid}-${n}`;
    await prisma.donation.create({
      data: { id: donationId, amount: 100_000, paymentMethod: 'bank_transfer', campaignId },
    });
    const paymentId = `payment-${process.pid}-${n}`;
    await prisma.payment.create({
      data: {
        id: paymentId,
        donationId,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${n}`,
        amount: 100_000,
        status: 'PAID',
        escrowReleaseAt,
        escrowReleasedAt: null,
      },
    });
    return paymentId;
  }

  it(
    'reaches a releasable Payment behind more permanently-stuck (SUSPENDED-Campaign) Payments than a ' +
      'single call\'s injected scan limit, within 2 calls, against a real Postgres',
    async () => {
      const creator = await makeUser();
      const suspendedCampaign = await makeCampaign(creator, 'SUSPENDED');
      const activeCampaign = await makeCampaign(creator, 'ACTIVE');

      // scanLimit is injected small (5) so this test seeds a handful of real
      // rows, not thousands -- see ReleaseSweepOptions' own doc comment in
      // escrow.ts for why this is a parameter and not a mutated constant.
      // More stuck rows than that limit is the whole point: a single call's
      // read cannot reach all of them.
      const SCAN_LIMIT = 5;
      const STUCK_COUNT = SCAN_LIMIT + 2;
      const base = Date.now() - 60 * 24 * 60 * 60 * 1000;
      const stuckPaymentIds: string[] = [];
      for (let i = 0; i < STUCK_COUNT; i++) {
        stuckPaymentIds.push(await makeMaturedPayment(suspendedCampaign, new Date(base + i * 1000)));
      }
      const releasablePaymentId = await makeMaturedPayment(
        activeCampaign,
        new Date(base + STUCK_COUNT * 1000),
      );

      // Call 1: entirely consumed by (a subset of) the SUSPENDED backlog --
      // it cannot reach the releasable Payment yet.
      const first = await releaseMaturedEscrow(undefined, new Date(), { scanLimit: SCAN_LIMIT });
      expect(first.releasedCount).toBe(0);
      expect(first.consideredCount).toBe(SCAN_LIMIT);

      let releasable = await prisma.payment.findUniqueOrThrow({ where: { id: releasablePaymentId } });
      expect(releasable.escrowReleasedAt).toBeNull();

      // Every row call 1 looked at now carries escrowSweepDeferredAt, so it
      // rotates behind whatever call 1 never reached -- proved directly,
      // not merely inferred from call 2's result.
      const markedAfterFirstCall = await prisma.payment.count({
        where: { id: { in: stuckPaymentIds }, escrowSweepDeferredAt: { not: null } },
      });
      expect(markedAfterFirstCall).toBe(SCAN_LIMIT);

      // Call 2: the rotation puts the remaining, never-yet-marked stuck rows
      // and the releasable Payment ahead of the ones call 1 already marked.
      const second = await releaseMaturedEscrow(undefined, new Date(), { scanLimit: SCAN_LIMIT });
      expect(second.releasedCount).toBe(1);

      releasable = await prisma.payment.findUniqueOrThrow({ where: { id: releasablePaymentId } });
      expect(releasable.escrowReleasedAt).not.toBeNull();
      // Released, so its deferral marker (if it was ever stuck; here it
      // never was) reads null either way -- the case a stuck-then-released
      // Payment exercises is asserted below on a payment that WAS stuck.
      expect(releasable.escrowSweepDeferredAt).toBeNull();

      const releaseLeg = await prisma.ledgerEntry.findFirst({
        where: { transactionId: `escrow-release:${releasablePaymentId}`, account: 'CAMPAIGN_BALANCE', direction: 'CREDIT' },
      });
      expect(releaseLeg).toMatchObject({ amount: 100_000, campaignId: activeCampaign });

      // Not one single stuck (SUSPENDED-campaign) Payment was released by
      // either call.
      const releasedStuckCount = await prisma.payment.count({
        where: { id: { in: stuckPaymentIds }, escrowReleasedAt: { not: null } },
      });
      expect(releasedStuckCount).toBe(0);
    },
    30_000,
  );

  it('clears escrowSweepDeferredAt on the call that finally releases a Payment that WAS stuck', async () => {
    const creator = await makeUser();
    const campaign = await makeCampaign(creator, 'SUSPENDED');
    const paymentId = await makeMaturedPayment(campaign, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    await releaseMaturedEscrow({ type: 'campaign', id: campaign });
    let payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.escrowReleasedAt).toBeNull();
    expect(payment.escrowSweepDeferredAt).not.toBeNull();

    // The Suspension lifts.
    await prisma.campaign.update({ where: { id: campaign }, data: { lifecycleStatus: 'ACTIVE' } });

    const result = await releaseMaturedEscrow({ type: 'campaign', id: campaign });
    expect(result).toEqual({ releasedCount: 1, consideredCount: 1 });

    payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.escrowReleasedAt).not.toBeNull();
    expect(payment.escrowSweepDeferredAt).toBeNull();
  }, 30_000);
});
