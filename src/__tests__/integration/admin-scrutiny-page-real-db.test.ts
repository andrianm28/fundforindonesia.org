// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * /admin/scrutiny (ticket rilis-1-benda/67) against a REAL Postgres.
 *
 * The page's two promises that a mocked Prisma cannot keep:
 *   - no beta data in what it shows (ticket 92). Whether a Penanda Donasi is
 *     listed rides on a relation filter over the Donation's Payments, and a
 *     Penanda Audit's Gross is the lifetime counter less the sandbox Gross; a
 *     fake answers whatever it is told, the database answers the question that
 *     was asked, including for a Donation that was retried and settled by a
 *     different Payment than its first attempt;
 *   - newest first, which is the database's ordering.
 * and, since the rows here are real ones, that nothing a Donor typed or an
 * account holds reaches the page.
 *
 * Same setup as beta-sandbox-counted-payments-real-db.test.ts.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('/admin/scrutiny -- against real Postgres (ticket 67)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[admin scrutiny] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `admin_scrutiny_${process.pid}`;
  let prisma: PrismaClient;
  let page: string;
  /** The Penanda Audit list and the Penanda Donasi list, cut apart at the second section. */
  let audit: string;
  let donations: string;

  let counter = 0;
  const next = () => counter++;

  async function makeUser(name: string): Promise<string> {
    const id = `user-${next()}`;
    await prisma.user.create({
      data: {
        id,
        name,
        emailHmac: `${id}-hmac`,
        emailHmacKeyId: 'k',
        emailCiphertext: `${id}-ciphertext`,
        emailKeyId: 'k',
      },
    });
    return id;
  }

  async function makeCampaign(title: string, ownerId: string, collectedAmount: number): Promise<string> {
    const id = `campaign-${next()}`;
    await prisma.campaign.create({
      data: {
        id,
        slug: id,
        title,
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 1_000_000_000,
        collectedAmount,
        category: 'Zakat Maal',
        kind: 'ZAKAT',
        creatorId: ownerId,
        lifecycleStatus: 'ACTIVE',
        location: `scrutiny-${id}`,
      },
    });
    return id;
  }

  /** A Donation with one Payment per attempt, in order: the last PAID or REFUNDED one is the one that settled it. */
  async function makeDonation(
    id: string,
    campaignId: string,
    amount: number,
    attempts: Array<{ status: 'PAID' | 'REFUNDED' | 'EXPIRED'; sandbox: boolean }>,
    donor: { guestName?: string; isAnonymous?: boolean; donorId?: string } = {},
  ) {
    await prisma.donation.create({
      data: { id, amount, paymentMethod: 'bank_transfer', campaignId, ...donor },
    });
    for (const attempt of attempts) {
      await prisma.payment.create({
        data: {
          donationId: id,
          provider: 'sumopod',
          method: 'bank_transfer',
          providerRef: `ref-${next()}`,
          amount,
          sandbox: attempt.sandbox,
          status: attempt.status,
        },
      });
    }
  }

  async function mark(donationId: string, campaignId: string, amount: number, flaggedAt: string) {
    await prisma.donationReviewMarker.create({
      data: { donationId, campaignId, amount, threshold: 50_000_000, flaggedAt: new Date(flaggedAt) },
    });
  }

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
      getServerSession: async () => ({ user: { id: 'admin-1', assignments: ['ADMIN'] } }),
    }));
    vi.doMock('next/navigation', () => ({
      notFound: () => {
        throw new Error('NEXT_NOT_FOUND');
      },
    }));

    const owner = await makeUser('Pemilik Campaign');
    const siti = await makeUser('Siti Donatur');

    // Three Campaigns over the audit limit (Rp500 juta) by the stored counter.
    //   - Besar Nyata: Rp520 juta, no test money at all.
    //   - Besar Campuran: Rp700 juta of which Rp100 juta is sandbox Gross, so
    //     Rp600 juta still counts, which is over the limit.
    //   - Hanya Uji: Rp560 juta of which Rp158 juta is sandbox Gross, so only
    //     Rp402 juta counts, which is not over the limit.
    const real = await makeCampaign('Campaign Besar Nyata', owner, 520_000_000);
    const mixed = await makeCampaign('Campaign Besar Campuran', owner, 700_000_000);
    const testOnly = await makeCampaign('Campaign Hanya Uji', owner, 560_000_000);

    for (const [campaignId, placedAt] of [
      [real, '2026-10-01T03:00:00.000Z'],
      [mixed, '2026-10-03T03:00:00.000Z'],
      [testOnly, '2026-10-02T03:00:00.000Z'],
    ] as const) {
      await prisma.campaignAuditMarker.create({
        data: { campaignId, cumulativeGross: 999_000_000, threshold: 500_000_000, placedAt: new Date(placedAt) },
      });
    }

    // Test money with no marker of its own, so the counter above is explained.
    await makeDonation('donation-test-extra', mixed, 30_000_000, [{ status: 'PAID', sandbox: true }]);
    await makeDonation('donation-test-big', testOnly, 100_000_000, [{ status: 'PAID', sandbox: true }]);

    // Donations over the single-Donation limit (Rp50 juta), oldest flag first.
    await makeDonation('donation-live', real, 60_000_000, [{ status: 'PAID', sandbox: false }], {
      guestName: 'Budi Rahasia',
      isAnonymous: true,
    });
    await makeDonation('donation-refunded', real, 55_000_000, [{ status: 'REFUNDED', sandbox: false }]);
    await makeDonation('donation-registered', real, 51_000_000, [{ status: 'PAID', sandbox: false }], {
      donorId: siti,
    });
    // First attempt in the beta, settled after go-live: a real Donation.
    await makeDonation('donation-retried-live', real, 52_000_000, [
      { status: 'EXPIRED', sandbox: true },
      { status: 'PAID', sandbox: false },
    ]);
    // Test money outright.
    await makeDonation('donation-sandbox', mixed, 70_000_000, [{ status: 'PAID', sandbox: true }]);
    // A live attempt that expired, then settled by a test Payment: test money.
    await makeDonation('donation-expired-then-sandbox', testOnly, 58_000_000, [
      { status: 'EXPIRED', sandbox: false },
      { status: 'PAID', sandbox: true },
    ]);

    await mark('donation-live', real, 60_000_000, '2026-10-01T03:00:00.000Z');
    await mark('donation-refunded', real, 55_000_000, '2026-10-02T03:00:00.000Z');
    await mark('donation-registered', real, 51_000_000, '2026-10-03T03:00:00.000Z');
    await mark('donation-retried-live', real, 52_000_000, '2026-10-04T03:00:00.000Z');
    await mark('donation-sandbox', mixed, 70_000_000, '2026-10-05T03:00:00.000Z');
    await mark('donation-expired-then-sandbox', testOnly, 58_000_000, '2026-10-06T03:00:00.000Z');

    const { default: AdminScrutinyPage } = await import('@/app/admin/scrutiny/page');
    page = renderToStaticMarkup(await AdminScrutinyPage());
    [audit, donations] = page.split('id="scrutiny-donation"');
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  it('lists a Penanda Audit with the Gross that counts, never the stored counter or the marker snapshot', () => {
    expect(audit).toContain('Campaign Besar Nyata');
    expect(audit).toContain('Rp520.000.000');
    expect(audit).toContain('Campaign Besar Campuran');
    expect(audit).toContain('Rp600.000.000');
    // The counter (700 juta) and the snapshot the markers carry (999 juta)
    // both include test money.
    expect(audit).not.toContain('700.000.000');
    expect(audit).not.toContain('999.000.000');
  });

  it('leaves out the Penanda Audit that only test money put over the limit', () => {
    expect(audit).not.toContain('Campaign Hanya Uji');
    expect(audit).not.toContain('Rp402.000.000');
    expect(audit).not.toContain('560.000.000');
  });

  it('lists the Penanda Audit newest first', () => {
    expect(audit.indexOf('Campaign Besar Campuran')).toBeGreaterThan(-1);
    expect(audit.indexOf('Campaign Besar Campuran')).toBeLessThan(audit.indexOf('Campaign Besar Nyata'));
  });

  it('lists a Penanda Donasi when the Donation settled with a Payment that counts, refunded or retried included', () => {
    for (const id of ['donation-live', 'donation-refunded', 'donation-registered', 'donation-retried-live']) {
      expect(donations).toContain(id);
    }
  });

  it('leaves out a Penanda Donasi whose Donation was settled by test money', () => {
    expect(donations).not.toContain('donation-sandbox');
    expect(donations).not.toContain('donation-expired-then-sandbox');
    expect(donations).not.toContain('Rp70.000.000');
    expect(donations).not.toContain('Rp58.000.000');
  });

  it('lists the Penanda Donasi newest first', () => {
    const order = ['donation-retried-live', 'donation-registered', 'donation-refunded', 'donation-live'].map((id) =>
      donations.indexOf(id),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position > -1)).toBe(true);
  });

  it('prints nothing a Donor typed or an account holds: not the anonymous name, not the account name, no email', () => {
    for (const personal of ['Budi Rahasia', 'Siti Donatur', 'hmac', 'ciphertext']) {
      expect(page).not.toContain(personal);
    }
  });
});
