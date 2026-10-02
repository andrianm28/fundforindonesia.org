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
 * Ticket 52: a `paid` event for a Payment already EXPIRED or FAILED must not be
 * dropped, against a REAL Postgres. The money is at the provider; every path
 * here must leave it in the ledger, and the WebhookEvent must say which path.
 *
 * (Setup copied from webhook-settlement-real-db.test.ts, which this follows.)
 *
 * Why this file exists: commit 4e55f3b spread `SELECT_DONATION_GUEST_EMAIL`
 * (two scalars) into a Prisma `include`, which Prisma rejects at validation
 * time, so every webhook answered 500 and no Payment ever reached PAID. The
 * mock-Prisma tests (donation-flow.test.ts and the route's own) return
 * whatever they are told and never validate a query, so they could not see it.
 * Only a real client validates the shape of `include`.
 *
 * The route is called end to end with a validly signed MockPaymentProvider
 * `settlement` event for (a) a Donation by an account holder, (b) a Guest
 * Donation whose email exists only as a ciphertext (ADR 0012), and (c) a Trip
 * Fee Registration. Skipped visibly, not passed, when TEST_DATABASE_URL is
 * unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SERVER_KEY = 'test-mock-server-key';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

type SentMail = { to: string };
const sentMail: SentMail[] = [];

describe.skipIf(!DATABASE_URL)('payment event paid after expiry -- against real Postgres', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[webhook settlement real db] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `webhook_late_paid_${process.pid}`;
  let prisma: PrismaClient;
  let webhook: typeof import('@/app/api/webhooks/[provider]/route').POST;
  let sealUserEmail: typeof import('@/lib/contact-fields').sealUserEmail;
  let sealDonationGuestEmail: typeof import('@/lib/contact-fields').sealDonationGuestEmail;
  let provider: import('@/lib/payments').MockPaymentProvider;

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

    // After the database exists, before anything resolving '@/lib/prisma' loads.
    vi.doMock('@/lib/prisma', () => ({ prisma, default: prisma }));
    vi.doMock('@/lib/mail', async () => {
      const actual = await vi.importActual<typeof import('@/lib/mail')>('@/lib/mail');
      return {
        ...actual,
        sendReportingFailure: async (message: SentMail) => {
          sentMail.push(message);
          return true;
        },
      };
    });
    ({ POST: webhook } = await import('@/app/api/webhooks/[provider]/route'));
    ({ sealUserEmail, sealDonationGuestEmail } = await import('@/lib/contact-fields'));
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

  async function makeUser(email?: string): Promise<string> {
    const id = `u-${process.pid}-${next()}`;
    await prisma.user.create({
      data: { id, name: 'Test User', ...sealUserEmail(email ?? `${id}@example.test`) },
    });
    return id;
  }

  async function makeCampaign(): Promise<string> {
    const creatorId = await makeUser();
    const registrarId = await makeUser();
    const entity = await prisma.partnerOrganisation.create({
      data: { name: 'Yayasan Uji', fundraiserId: creatorId, registeredById: registrarId },
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
      },
    });
    return id;
  }

  async function pendingDonationPayment(guest: boolean) {
    const campaignId = await makeCampaign();
    const n = next();
    const email = `${guest ? 'guest' : 'donor'}-${process.pid}-${n}@example.test`;
    const donorId = guest ? null : await makeUser(email);
    const donation = await prisma.donation.create({
      data: {
        amount: 100_000,
        paymentMethod: 'bank_transfer',
        campaignId,
        donorId,
        ...(guest ? { guestName: 'Tamu Uji', ...sealDonationGuestEmail(email) } : {}),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        donationId: donation.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${n}`,
        amount: 100_000,
        status: 'PENDING',
      },
    });
    return { donation, payment, expectedEmail: email };
  }

  async function pendingTripFeePayment() {
    const fundraiserId = await makeUser();
    const volunteerId = await makeUser();
    const trip = await prisma.volunteerTrip.create({
      data: {
        slug: `trip-${process.pid}-${next()}`,
        title: 'T',
        description: 'd',
        story: 's',
        coverImage: 'https://example.com/c.jpg',
        destination: 'x',
        itinerary: 'i',
        tripFeeAmount: 500_000,
        status: 'ACTIVE',
        fundraiserId,
      },
    });
    const batch = await prisma.volunteerBatch.create({
      data: {
        tripId: trip.id,
        startDate: new Date(Date.now() + 30 * MS_PER_DAY),
        endDate: new Date(Date.now() + 33 * MS_PER_DAY),
        registrationDeadline: new Date(Date.now() + 25 * MS_PER_DAY),
        maxQuota: 5,
        minQuota: 1,
      },
    });
    const registration = await prisma.registration.create({
      data: { volunteerId, batchId: batch.id, status: 'HOLD', holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
    const payment = await prisma.payment.create({
      data: {
        registrationId: registration.id,
        provider: 'mock',
        method: 'bank_transfer',
        providerRef: `ref-${process.pid}-${next()}`,
        amount: 500_000,
        status: 'PENDING',
      },
    });
    return { registration, payment };
  }

  async function sendPaid(providerRef: string, amount: number, eventId = `evt-${providerRef}`): Promise<Response> {
    const body = await provider.simulateWebhookPayload(providerRef, amount, 'settlement', eventId);
    const request = new NextRequest('http://localhost/api/webhooks/mock', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return webhook(request, { params: Promise.resolve({ provider: 'mock' }) });
  }

  async function eventOf(eventId: string) {
    return prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: 'mock', providerEventId: eventId } },
    });
  }

  it.each([
    { from: 'EXPIRED', outcome: 'PAID_AFTER_EXPIRED' },
    { from: 'FAILED', outcome: 'PAID_AFTER_FAILED' },
  ] as const)('a Donation Payment $from then paid is settled, ledgered, receipted and labelled $outcome', async ({ from, outcome }) => {
    sentMail.length = 0;
    const { donation, payment } = await pendingDonationPayment(false);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: from } });
    await prisma.donation.update({ where: { id: donation.id }, data: { paymentStatus: 'failed' } });

    const res = await sendPaid(payment.providerRef, 100_000);

    expect(res.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID');
    expect((await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } })).paymentStatus).toBe('confirmed');
    expect(await prisma.receipt.count({ where: { donationId: donation.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBeGreaterThan(0);
    const event = await eventOf(`evt-${payment.providerRef}`);
    expect(event.processedAt).not.toBeNull();
    expect(event.outcome).toBe(outcome);
  });

  it('a Trip Fee paid after its Payment and hold EXPIRED is ledgered and refunded in full, and takes no seat', async () => {
    const { registration, payment } = await pendingTripFeePayment();
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
    await prisma.registration.update({ where: { id: registration.id }, data: { status: 'EXPIRED' } });

    const res = await sendPaid(payment.providerRef, 500_000);

    expect(res.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID');
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe('EXPIRED');
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBeGreaterThan(0);
    const refunds = await prisma.refund.findMany({ where: { paymentId: payment.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(500_000);
    expect((await eventOf(`evt-${payment.providerRef}`)).outcome).toBe('PAID_AFTER_EXPIRED');
  });

  it('delivering the same late paid event twice books it once', async () => {
    const { registration, payment } = await pendingTripFeePayment();
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
    await prisma.registration.update({ where: { id: registration.id }, data: { status: 'EXPIRED' } });

    await sendPaid(payment.providerRef, 500_000);
    const ledger = await prisma.ledgerEntry.count({ where: { paymentId: payment.id } });
    const second = await sendPaid(payment.providerRef, 500_000);

    expect(second.status).toBe(200);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(ledger);
    expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: `evt-${payment.providerRef}` } })).toBe(1);
  });

  it('two DISTINCT late paid events racing on one EXPIRED Payment settle it once; the loser is labelled, not lost', async () => {
    const { donation, payment } = await pendingDonationPayment(false);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });

    const [a, b] = await Promise.all([
      sendPaid(payment.providerRef, 100_000, `evt-a-${payment.providerRef}`),
      sendPaid(payment.providerRef, 100_000, `evt-b-${payment.providerRef}`),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await prisma.receipt.count({ where: { donationId: donation.id } })).toBe(1);
    const events = [await eventOf(`evt-a-${payment.providerRef}`), await eventOf(`evt-b-${payment.providerRef}`)];
    expect(events.every((e) => e.processedAt !== null)).toBe(true);
    expect(events.map((e) => e.outcome).sort()).toEqual(['LOST_RACE', 'PAID_AFTER_EXPIRED']);
    const legs = await prisma.ledgerEntry.findMany({ where: { paymentId: payment.id } });
    expect(new Set(legs.map((l) => l.transactionId)).size).toBe(1);
  });

  it('a late paid event whose amount disagrees books nothing and is labelled AMOUNT_MISMATCH for an Admin', async () => {
    const { payment } = await pendingDonationPayment(false);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });

    await sendPaid(payment.providerRef, 90_000);

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('EXPIRED');
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(0);
    expect((await eventOf(`evt-${payment.providerRef}`)).outcome).toBe('AMOUNT_MISMATCH');
  });

  it('a paid event naming no known Payment is labelled UNKNOWN_PAYMENT', async () => {
    const ref = `ghost-${process.pid}-${next()}`;
    const res = await sendPaid(ref, 100_000);
    expect(res.status).toBe(200);
    expect((await eventOf(`evt-${ref}`)).outcome).toBe('UNKNOWN_PAYMENT');
  });

  it('records a charge that has no Payment for an Admin to reconcile', async () => {
    const { recordChargeWriteFailure } = await import('@/lib/money/payment-reconciliation');
    await recordChargeWriteFailure(prisma, {
      provider: 'mock',
      providerRef: 'reg-orphan-1',
      subjectType: 'registration',
      subjectId: 'reg-orphan-1',
      amount: 500_000,
      error: new Error('connection reset'),
    });
    const rows = await prisma.chargeWriteFailure.findMany({ where: { providerRef: 'reg-orphan-1' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 500_000, subjectType: 'registration', resolvedAt: null });
    expect(rows[0].errorMessage).toContain('connection reset');
  });
});
