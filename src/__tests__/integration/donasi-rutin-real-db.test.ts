// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { ChargeInput, ChargeResult, PaymentProvider } from '@/lib/payments';
import type { MailMessage, Mailer } from '@/lib/mail';

/**
 * PKS pemenuhan 18 (pasal 4.7): the recurring donation, against a REAL Postgres.
 *
 * What is under test is money: one bill per cycle however often the job runs
 * (the unique (recurringId, cycleIndex) claim, inserted first), a bill that is
 * an ordinary PENDING Donation made through the existing donation path, every
 * gate that must stop a bill (switch, Admin switch, Campaign no longer
 * accepting, previous cycle still pending), the signed stop link, and the cycle
 * status the EXISTING webhook produces. A mock Prisma would return whatever it
 * was told and could not show the unique constraint doing its job.
 *
 * Skipped visibly, not passed, when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
// Built at runtime: the repo's secret scanners flag key-looking literals.
const SERVER_KEY = ['mock', 'server', 'key', String(process.pid)].join('-');
const NOW = new Date('2026-11-15T03:00:00.000Z');

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

describe.skipIf(!DATABASE_URL)('recurring donation (PKS 4.7) -- against real Postgres', () => {
  if (!DATABASE_URL) {
    console.warn('[donasi rutin real db] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing.');
  }

  const databaseName = `donasi_rutin_${process.pid}`;
  let prisma: PrismaClient;
  let billing: typeof import('@/lib/recurring-donations/billing');
  let service: typeof import('@/lib/recurring-donations/service');
  let stopToken: typeof import('@/lib/recurring-donations/stop-token');
  let stopRoute: typeof import('@/app/api/donasi-rutin/berhenti/[token]/route');
  let webhook: typeof import('@/app/api/webhooks/[provider]/route').POST;
  let sealUserEmail: typeof import('@/lib/contact-fields').sealUserEmail;
  let mockProvider: import('@/lib/payments').MockPaymentProvider;

  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    name: 'test',
    send: async (message) => {
      sent.push(message);
    },
  };
  let chargesAsked = 0;
  let failCharges = false;

  /** A provider that issues a payment link, the way Sumopod's QRIS link does. */
  const linkProvider: PaymentProvider = {
    name: 'mock',
    method: 'qris_redirect',
    supportedMethods: ['qris_redirect'],
    async createCharge(input: ChargeInput): Promise<ChargeResult> {
      chargesAsked += 1;
      if (failCharges) throw new Error('provider down');
      return {
        providerOrderId: input.orderId,
        method: 'qris_redirect',
        redirectUrl: `https://pay.example.test/${input.orderId}`,
        expiresAt: new Date(NOW.getTime() + 24 * 3600 * 1000),
      };
    },
    async parseWebhook() {
      throw new Error('not used');
    },
    async getStatus() {
      throw new Error('not used');
    },
  } as unknown as PaymentProvider;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    process.env.MOCK_MIDTRANS_SERVER_KEY = SERVER_KEY;
    process.env.NEXTAUTH_SECRET = randomBytes(24).toString('hex');
    process.env.NEXT_PUBLIC_DONATIONS_ENABLED = 'true';
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
    // The active provider is a link provider (the mock adapter only does VAs);
    // everything else in the module is the real one.
    vi.doMock('@/lib/payments/active-provider', async () => {
      const actual = await vi.importActual<typeof import('@/lib/payments/active-provider')>(
        '@/lib/payments/active-provider',
      );
      return {
        ...actual,
        resolveActivePaymentProvider: async () => ({
          provider: linkProvider,
          enabledMethods: ['qris_redirect'],
          source: 'environment',
        }),
      };
    });
    vi.doMock('@/lib/mail', async () => {
      const actual = await vi.importActual<typeof import('@/lib/mail')>('@/lib/mail');
      return {
        ...actual,
        sendReportingFailure: async (message: MailMessage) => {
          sent.push(message);
          return true;
        },
      };
    });

    billing = await import('@/lib/recurring-donations/billing');
    service = await import('@/lib/recurring-donations/service');
    stopToken = await import('@/lib/recurring-donations/stop-token');
    stopRoute = await import('@/app/api/donasi-rutin/berhenti/[token]/route');
    ({ POST: webhook } = await import('@/app/api/webhooks/[provider]/route'));
    ({ sealUserEmail } = await import('@/lib/contact-fields'));
    const payments = await import('@/lib/payments');
    mockProvider = new payments.MockPaymentProvider({ serverKey: SERVER_KEY });
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await prisma?.$disconnect();
    const admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  beforeEach(async () => {
    // Every test starts with no recurring donation but its own, so one job run
    // never bills (and a count never includes) another test's.
    await prisma.recurringDonation.deleteMany();
    sent.length = 0;
    chargesAsked = 0;
    failCharges = false;
    process.env.NEXT_PUBLIC_DONATIONS_ENABLED = 'true';
  });

  let counter = 0;
  const next = () => counter++;

  async function makeUser(email?: string): Promise<string> {
    const id = `u-${process.pid}-${next()}`;
    await prisma.user.create({ data: { id, name: 'Donatur Uji', ...sealUserEmail(email ?? `${id}@example.test`) } });
    return id;
  }

  async function makeCampaign(overrides: Record<string, unknown> = {}): Promise<string> {
    const creatorId = await makeUser();
    const registrarId = await makeUser();
    const entity = await prisma.partnerOrganisation.create({
      data: { name: 'Yayasan Uji', fundraiserId: creatorId, registeredById: registrarId },
    });
    // A Campaign takes donations only while its Collecting Entity holds a valid permit.
    await prisma.fundraisingPermit.create({
      data: {
        partnerOrganisationId: entity.id,
        number: `IZIN-${process.pid}-${next()}`,
        issuer: 'Kementerian Uji',
        kinds: ['DONATION', 'WAKAF'],
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2028-01-01T00:00:00.000Z'),
        recordedById: registrarId,
      },
    });
    const id = `c-${process.pid}-${next()}`;
    await prisma.campaign.create({
      data: {
        id,
        slug: id,
        title: 'Kampanye Uji',
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        targetAmount: 10_000_000,
        category: 'test',
        creatorId,
        lifecycleStatus: 'ACTIVE',
        collectingEntityId: entity.id,
        ...overrides,
      },
    });
    return id;
  }

  /** A monthly recurring donation starting on the 15th, so cycle 0 is due at NOW. */
  async function makeRecurring(opts: { donorId?: string; campaignId?: string; amount?: number; status?: 'ACTIVE' | 'STOPPED' } = {}) {
    const donorId = opts.donorId ?? (await makeUser());
    const campaignId = opts.campaignId ?? (await makeCampaign());
    return prisma.recurringDonation.create({
      data: {
        donorId,
        campaignId,
        amount: opts.amount ?? 50_000,
        period: 'MONTHLY',
        startDate: new Date('2026-11-15T00:00:00.000Z'),
        status: opts.status ?? 'ACTIVE',
      },
    });
  }

  const cyclesOf = (recurringId: string) =>
    prisma.recurringDonationCycle.findMany({ where: { recurringId }, orderBy: { cycleIndex: 'asc' } });

  async function pay(donationId: string, status: 'settlement' | 'expire' = 'settlement') {
    const payment = await prisma.payment.findFirstOrThrow({ where: { donationId } });
    const body = await mockProvider.simulateWebhookPayload(payment.providerRef, payment.amount, status, `evt-${payment.providerRef}-${status}`);
    const request = new NextRequest('http://localhost/api/webhooks/mock', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return webhook(request, { params: Promise.resolve({ provider: 'mock' }) });
  }

  describe('the scheduler', () => {
    it('issues one ordinary PENDING Donation with a payment link, an email and an inbox notice for a due cycle', async () => {
      const rec = await makeRecurring();

      const result = await billing.runRecurringDonationBilling(NOW, mailer);

      expect(result.issuedCount).toBe(1);
      const [cycle] = await cyclesOf(rec.id);
      expect(cycle.cycleIndex).toBe(0);
      const donation = await prisma.donation.findUniqueOrThrow({ where: { id: cycle.donationId! } });
      expect(donation).toMatchObject({
        amount: 50_000,
        paymentStatus: 'pending',
        donorId: rec.donorId,
        campaignId: rec.campaignId,
      });
      const payment = await prisma.payment.findFirstOrThrow({ where: { donationId: donation.id } });
      expect(payment).toMatchObject({ status: 'PENDING', providerRef: donation.id, method: 'qris_redirect', amount: 50_000 });
      // No money moved: a bill posts nothing to the ledger.
      expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(0);

      const mail = sent.filter((m) => m.text.includes(payment.redirectUrl!));
      expect(mail).toHaveLength(1);
      const stopUrl = /https?:\/\/\S+\/donasi-rutin\/berhenti\/(\S+)/.exec(mail[0].text);
      expect(stopUrl).not.toBeNull();
      expect(stopToken.verifyRecurringStopToken(stopUrl![1], NOW.getTime())).toBe(rec.id);
      const notices = await prisma.notification.findMany({ where: { userId: rec.donorId, type: 'recurring_donation_bill' } });
      expect(notices).toHaveLength(1);
      expect(notices[0].link).toBe('/akun/donasi-rutin');
    });

    it('issues one bill per cycle when the job runs twice, and when two runs overlap', async () => {
      const rec = await makeRecurring();

      await billing.runRecurringDonationBilling(NOW, mailer);
      await billing.runRecurringDonationBilling(new Date(NOW.getTime() + 15 * 60_000), mailer);
      await Promise.all([
        billing.runRecurringDonationBilling(NOW, mailer),
        billing.runRecurringDonationBilling(NOW, mailer),
      ]);

      expect(await cyclesOf(rec.id)).toHaveLength(1);
      const donations = await prisma.donation.findMany({ where: { donorId: rec.donorId } });
      expect(donations).toHaveLength(1);
      expect(await prisma.payment.count({ where: { donationId: donations[0].id } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: rec.donorId, type: 'recurring_donation_bill' } })).toBe(1);
    });

    it('bills the next cycle only once the previous one is no longer pending', async () => {
      const rec = await makeRecurring();
      await billing.runRecurringDonationBilling(NOW, mailer);
      const dec = new Date('2026-12-15T03:00:00.000Z');

      // Cycle 0 still unpaid, its payment link still open: cycle 1 is not billed.
      const [first] = await cyclesOf(rec.id);
      await prisma.payment.updateMany({
        where: { donationId: first.donationId!, status: 'PENDING' },
        data: { expiresAt: new Date('2026-12-31T00:00:00.000Z') },
      });
      await billing.runRecurringDonationBilling(dec, mailer);
      expect(await cyclesOf(rec.id)).toHaveLength(1);

      // Once cycle 0 lapsed (webhook expiry), cycle 1 is.
      expect((await pay(first.donationId!, 'expire')).status).toBe(200);
      await billing.runRecurringDonationBilling(dec, mailer);
      const cycles = await cyclesOf(rec.id);
      expect(cycles.map((c) => c.cycleIndex)).toEqual([0, 1]);
      expect(cycles[1].donationId).not.toBeNull();
    });

    it('bills the next cycle when the previous link expired and no webhook ever came', async () => {
      const rec = await makeRecurring();
      await billing.runRecurringDonationBilling(NOW, mailer);
      const [first] = await cyclesOf(rec.id);
      await prisma.payment.updateMany({
        where: { donationId: first.donationId!, status: 'PENDING' },
        data: { expiresAt: new Date('2026-11-16T03:00:00.000Z') },
      });

      await billing.runRecurringDonationBilling(new Date('2026-12-15T03:00:00.000Z'), mailer);

      expect((await cyclesOf(rec.id)).map((c) => c.cycleIndex)).toEqual([0, 1]);
      expect((await prisma.donation.findUniqueOrThrow({ where: { id: first.donationId! } })).paymentStatus).toBe('pending');
    });

    it('bills only the cycle due now after the job missed several, never a backlog', async () => {
      const rec = await makeRecurring();
      await billing.runRecurringDonationBilling(new Date('2027-03-20T03:00:00.000Z'), mailer);
      expect((await cyclesOf(rec.id)).map((c) => c.cycleIndex)).toEqual([4]);
    });

    it.each([
      ['before its start date', async () => makeRecurring(), new Date('2026-11-14T23:00:00.000Z')],
      ['once stopped', async () => makeRecurring({ status: 'STOPPED' }), NOW],
    ])('issues nothing %s', async (_name, make, when) => {
      const rec = await make();
      await billing.runRecurringDonationBilling(when, mailer);
      expect(await cyclesOf(rec.id)).toHaveLength(0);
    });

    it('issues nothing when the target no longer accepts donations', async () => {
      const campaignId = await makeCampaign({ lifecycleStatus: 'COMPLETED' });
      const rec = await makeRecurring({ campaignId });
      await billing.runRecurringDonationBilling(NOW, mailer);
      expect(await cyclesOf(rec.id)).toHaveLength(0);
      expect(chargesAsked).toBe(0);
    });

    it('issues nothing, and asks the provider for nothing, while the donation switch is off', async () => {
      const rec = await makeRecurring();
      process.env.NEXT_PUBLIC_DONATIONS_ENABLED = 'false';
      await billing.runRecurringDonationBilling(NOW, mailer);
      expect(await cyclesOf(rec.id)).toHaveLength(0);
      expect(chargesAsked).toBe(0);
    });

    it('issues nothing while an Admin has switched donations off, and resumes when they are switched on', async () => {
      const rec = await makeRecurring();
      const { setOperations } = await import('@/lib/operations');
      const adminId = await makeUser();
      await setOperations(prisma, { patch: { donationsOpen: false }, actorId: adminId, actorName: 'Admin' });
      await billing.runRecurringDonationBilling(NOW, mailer);
      expect(await cyclesOf(rec.id)).toHaveLength(0);

      await setOperations(prisma, { patch: { donationsOpen: true }, actorId: adminId, actorName: 'Admin' });
      await billing.runRecurringDonationBilling(NOW, mailer);
      expect(await cyclesOf(rec.id)).toHaveLength(1);
    });

    it('when the provider refuses, the cycle is closed out failed and the Donor is not billed again that cycle', async () => {
      const rec = await makeRecurring();
      failCharges = true;
      await billing.runRecurringDonationBilling(NOW, mailer);
      failCharges = false;
      await billing.runRecurringDonationBilling(NOW, mailer);

      const [cycle] = await cyclesOf(rec.id);
      expect(cycle.donationId).not.toBeNull();
      expect((await prisma.donation.findUniqueOrThrow({ where: { id: cycle.donationId! } })).paymentStatus).toBe('failed');
      expect(await prisma.donation.count({ where: { donorId: rec.donorId } })).toBe(1);
      expect(sent).toHaveLength(0);
    });
  });

  describe('cycle status, from the existing webhook', () => {
    it('is pending until the Payment is PAID, then paid', async () => {
      const rec = await makeRecurring();
      await billing.runRecurringDonationBilling(NOW, mailer);
      const [cycle] = await cyclesOf(rec.id);

      let [view] = await service.listRecurringDonations(prisma, rec.donorId);
      expect(view.cycles[0]).toMatchObject({ cycleIndex: 0, status: 'PENDING' });
      expect(view.cycles[0].payUrl).toMatch(/^https:\/\/pay\.example\.test\//);

      expect((await pay(cycle.donationId!)).status).toBe(200);

      [view] = await service.listRecurringDonations(prisma, rec.donorId);
      expect(view.cycles[0]).toMatchObject({ status: 'PAID', payUrl: null });
    });

    it('is overdue when the payment link expires', async () => {
      const rec = await makeRecurring();
      await billing.runRecurringDonationBilling(NOW, mailer);
      const [cycle] = await cyclesOf(rec.id);

      expect((await pay(cycle.donationId!, 'expire')).status).toBe(200);

      const [view] = await service.listRecurringDonations(prisma, rec.donorId);
      expect(view.cycles[0]).toMatchObject({ status: 'OVERDUE', payUrl: null });
    });
  });

  describe('stopping', () => {
    function stopRequest(token: string) {
      return stopRoute.POST(new NextRequest(`http://localhost/api/donasi-rutin/berhenti/${token}`, { method: 'POST' }), {
        params: Promise.resolve({ token }),
      });
    }

    it('stops through the signed link with no login, and no further bill is issued', async () => {
      const rec = await makeRecurring();
      const other = await makeRecurring();
      const token = stopToken.signRecurringStopToken(rec.id, NOW.getTime());

      const res = await stopRequest(token);

      expect(res.status).toBeLessThan(400);
      const stopped = await prisma.recurringDonation.findUniqueOrThrow({ where: { id: rec.id } });
      expect(stopped.status).toBe('STOPPED');
      expect(stopped.stoppedAt).not.toBeNull();
      expect((await prisma.recurringDonation.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('ACTIVE');

      await billing.runRecurringDonationBilling(NOW, mailer);
      expect(await cyclesOf(rec.id)).toHaveLength(0);
      expect(await cyclesOf(other.id)).toHaveLength(1);

      // Following the same link again changes nothing and does not fail.
      expect((await stopRequest(token)).status).toBeLessThan(400);
    });

    it('refuses a tampered, foreign or expired link and stops nothing', async () => {
      const rec = await makeRecurring();
      const good = stopToken.signRecurringStopToken(rec.id, NOW.getTime());
      const expired = stopToken.signRecurringStopToken(rec.id, NOW.getTime() - 100 * 24 * 3600 * 1000);
      const unknownId = stopToken.signRecurringStopToken('does-not-exist', NOW.getTime());

      for (const token of [good.slice(0, -3) + 'AAA', 'junk', expired, unknownId]) {
        expect((await stopRequest(token)).status).toBe(404);
      }
      expect((await prisma.recurringDonation.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe('ACTIVE');
    });

    it("lets a Donor stop their own recurring donation from the account, and nobody else's", async () => {
      const rec = await makeRecurring();
      const stranger = await makeUser();

      expect(await service.stopRecurringDonation(prisma, { id: rec.id, donorId: stranger })).toEqual({ ok: false, error: 'not_found' });
      expect((await prisma.recurringDonation.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe('ACTIVE');

      expect(await service.stopRecurringDonation(prisma, { id: rec.id, donorId: rec.donorId })).toEqual({ ok: true });
      expect((await prisma.recurringDonation.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe('STOPPED');
    });
  });

  describe('registering', () => {
    const base = () => ({ amount: 50_000, period: 'MONTHLY' as const, startDate: new Date('2026-11-20T00:00:00.000Z'), now: NOW });

    it('creates an active recurring donation for a Campaign that accepts donations', async () => {
      const donorId = await makeUser();
      const campaignId = await makeCampaign();
      const result = await service.createRecurringDonation(prisma, { ...base(), donorId, campaignId });
      expect(result.ok).toBe(true);
      const row = await prisma.recurringDonation.findFirstOrThrow({ where: { donorId } });
      expect(row).toMatchObject({ status: 'ACTIVE', amount: 50_000, period: 'MONTHLY', campaignId });
    });

    it.each([
      ['below the minimum', { amount: 999 }, 'amount_out_of_range'],
      ['above the maximum', { amount: 1_000_000_001 }, 'amount_out_of_range'],
      ['not a whole number of rupiah', { amount: 1500.5 }, 'amount_out_of_range'],
      ['a start date in the past', { startDate: new Date('2026-11-01T00:00:00.000Z') }, 'start_in_past'],
    ])('refuses %s', async (_name, patch, error) => {
      const donorId = await makeUser();
      const campaignId = await makeCampaign();
      const result = await service.createRecurringDonation(prisma, { ...base(), ...patch, donorId, campaignId });
      expect(result).toEqual({ ok: false, error });
      expect(await prisma.recurringDonation.count({ where: { donorId } })).toBe(0);
    });

    it('refuses a Campaign that does not accept donations, a missing one, and a wakaf one', async () => {
      const donorId = await makeUser();
      const closed = await makeCampaign({ lifecycleStatus: 'COMPLETED' });
      const wakaf = await makeCampaign({ kind: 'WAKAF' });
      expect(await service.createRecurringDonation(prisma, { ...base(), donorId, campaignId: closed })).toEqual({ ok: false, error: 'campaign_unavailable' });
      expect(await service.createRecurringDonation(prisma, { ...base(), donorId, campaignId: 'nope' })).toEqual({ ok: false, error: 'campaign_unavailable' });
      expect(await service.createRecurringDonation(prisma, { ...base(), donorId, campaignId: wakaf })).toEqual({ ok: false, error: 'campaign_unavailable' });
    });
  });
});
