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
 * POST /api/webhooks/[provider] settling a Payment, against a REAL Postgres.
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
 * Fee Registration. Ticket 51 adds the provider-match rule: an event verified
 * by one provider is refused, and leaves the Payment alone, when the Payment
 * was charged through another. Skipped visibly, not passed, when TEST_DATABASE_URL is
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

describe.skipIf(!DATABASE_URL)('payment webhook settlement -- against real Postgres', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[webhook settlement real db] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `webhook_settlement_${process.pid}`;
  let prisma: PrismaClient;
  let webhook: typeof import('@/app/api/webhooks/[provider]/route').POST;
  let sealUserEmail: typeof import('@/lib/contact-fields').sealUserEmail;
  let sealDonationGuestEmail: typeof import('@/lib/contact-fields').sealDonationGuestEmail;
  let resend: typeof import('@/app/api/receipts/[token]/resend/route').POST;
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
    ({ POST: resend } = await import('@/app/api/receipts/[token]/resend/route'));
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

  async function deliverSettlement(
    providerRef: string,
    amount: number,
    providerEventId = `evt-${providerRef}`,
  ): Promise<Response> {
    const body = await provider.simulateWebhookPayload(providerRef, amount, 'settlement', providerEventId);
    const request = new NextRequest('http://localhost/api/webhooks/mock', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return webhook(request, { params: Promise.resolve({ provider: 'mock' }) });
  }

  it('settles a Donation by an account holder: Payment PAID, Receipt created, Receipt email to the decrypted donor address', async () => {
    sentMail.length = 0;
    const { donation, payment, expectedEmail } = await pendingDonationPayment(false);

    const res = await deliverSettlement(payment.providerRef, 100_000);

    expect(res.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID');
    expect((await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } })).paymentStatus).toBe('confirmed');
    expect(await prisma.receipt.count({ where: { donationId: donation.id } })).toBe(1);
    expect(sentMail.map((m) => m.to)).toContain(expectedEmail);
  });

  it('settles a Guest Donation and addresses the Receipt to the guest email decrypted from its ciphertext', async () => {
    sentMail.length = 0;
    const { donation, payment, expectedEmail } = await pendingDonationPayment(true);

    const res = await deliverSettlement(payment.providerRef, 100_000);

    expect(res.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID');
    expect(await prisma.receipt.count({ where: { donationId: donation.id } })).toBe(1);
    expect(sentMail.map((m) => m.to)).toContain(expectedEmail);
  });

  it('settles a Trip Fee: Payment PAID and Registration CONFIRMED', async () => {
    const { registration, payment } = await pendingTripFeePayment();

    const res = await deliverSettlement(payment.providerRef, 500_000);

    expect(res.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID');
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe('CONFIRMED');
  });

  // Ticket 51. The mock's signature is valid here -- the event is genuine for
  // /api/webhooks/mock -- but the Payment was charged through sumopod.
  it.each([
    { label: 'Donation', trip: false },
    { label: 'Trip Fee', trip: true },
  ])('refuses a mock-signed settlement for a sumopod $label Payment: 200, answered like an unknown ref, WebhookEvent kept unprocessed, nothing else written', async ({ trip }) => {
    sentMail.length = 0;
    const { payment } = trip ? await pendingTripFeePayment() : await pendingDonationPayment(false);
    await prisma.payment.update({ where: { id: payment.id }, data: { provider: 'sumopod' } });
    const before = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });

    const res = await deliverSettlement(payment.providerRef, payment.amount);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('PENDING');
    expect(after.paidAt).toBeNull();
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(0);
    expect(await prisma.receipt.count({ where: { donation: { payments: { some: { id: payment.id } } } } })).toBe(0);
    expect(sentMail).toHaveLength(0);
    const events = await prisma.webhookEvent.findMany({ where: { providerEventId: `evt-${payment.providerRef}` } });
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe('mock');
    expect(events[0].processedAt).toBeNull();
    if (trip) {
      const registrationId = (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).registrationId!;
      expect((await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } })).status).toBe('HOLD');
    }
  });

  it('a mock-signed settlement for a sumopod Payment stays refused on redelivery', async () => {
    const { payment } = await pendingDonationPayment(false);
    await prisma.payment.update({ where: { id: payment.id }, data: { provider: 'sumopod' } });

    expect((await deliverSettlement(payment.providerRef, 100_000)).status).toBe(200);
    expect((await deliverSettlement(payment.providerRef, 100_000)).status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
  });

  it('a provider-mismatched event does not poison its id: a genuine event with the same providerEventId is still settled', async () => {
    const wrong = await pendingDonationPayment(false);
    await prisma.payment.update({ where: { id: wrong.payment.id }, data: { provider: 'sumopod' } });
    const right = await pendingDonationPayment(false);
    const sharedEventId = `evt-shared-${process.pid}-${right.payment.providerRef}`;

    expect((await deliverSettlement(wrong.payment.providerRef, 100_000, sharedEventId)).status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: wrong.payment.id } })).status).toBe('PENDING');

    expect((await deliverSettlement(right.payment.providerRef, 100_000, sharedEventId)).status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: right.payment.id } })).status).toBe('PAID');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: wrong.payment.id } })).status).toBe('PENDING');
    const events = await prisma.webhookEvent.findMany({ where: { providerEventId: sharedEventId } });
    expect(events).toHaveLength(1);
    expect(events[0].processedAt).not.toBeNull();
  });

  // Idempotency: the provider retries. The same signed event delivered twice
  // answers 200 both times and changes nothing the second time.
  it.each([
    { label: 'account-holder Donation', guest: false },
    { label: 'Guest Donation', guest: true },
  ])('delivering the same settlement twice settles a $label once', async ({ guest }) => {
    sentMail.length = 0;
    const { donation, payment, expectedEmail } = await pendingDonationPayment(guest);

    const first = await deliverSettlement(payment.providerRef, 100_000);
    const afterFirst = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const ledgerAfterFirst = await prisma.ledgerEntry.count({ where: { paymentId: payment.id } });
    const second = await deliverSettlement(payment.providerRef, 100_000);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const afterSecond = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(afterSecond.status).toBe('PAID');
    expect(afterSecond.paidAt).toEqual(afterFirst.paidAt);
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);
    expect((await prisma.donation.findUniqueOrThrow({ where: { id: donation.id } })).paymentStatus).toBe('confirmed');
    expect(await prisma.receipt.count({ where: { donationId: donation.id } })).toBe(1);
    expect(ledgerAfterFirst).toBeGreaterThan(0);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(ledgerAfterFirst);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: `evt-${payment.providerRef}` } })).toBe(1);
    expect(sentMail.filter((m) => m.to === expectedEmail)).toHaveLength(1);
  });

  it('delivering the same settlement twice settles a Trip Fee once', async () => {
    sentMail.length = 0;
    const { registration, payment } = await pendingTripFeePayment();

    const first = await deliverSettlement(payment.providerRef, 500_000);
    const ledgerAfterFirst = await prisma.ledgerEntry.count({ where: { paymentId: payment.id } });
    const mailAfterFirst = sentMail.length;
    const confirmedAt = (await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).updatedAt;
    const second = await deliverSettlement(payment.providerRef, 500_000);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID');
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('CONFIRMED');
    expect(after.updatedAt).toEqual(confirmedAt);
    expect(ledgerAfterFirst).toBeGreaterThan(0);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(ledgerAfterFirst);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: `evt-${payment.providerRef}` } })).toBe(1);
    expect(sentMail).toHaveLength(mailAfterFirst);
  });

  // Trip Fee: the webhook sends NO email (only notifyRegistrationConfirmed's
  // in-app Notification; sendReportingFailure is reached only on the Donation
  // branch, for the Receipt). Pinned so a future Trip Fee email is a decision.
  it('first delivery for a Trip Fee sends no email and creates exactly one in-app confirmation', async () => {
    sentMail.length = 0;
    const { registration, payment } = await pendingTripFeePayment();

    const res = await deliverSettlement(payment.providerRef, 500_000);

    expect(res.status).toBe(200);
    expect(sentMail).toHaveLength(0);
    expect(
      await prisma.notification.count({ where: { userId: registration.volunteerId, type: 'registration_confirmed' } }),
    ).toBe(1);
  });

  // Two DIFFERENT events (distinct providerEventId) for one Payment: the
  // status-keyed updateMany lets only the first settle it.
  it('two different settlement events for one Donation Payment settle it once', async () => {
    sentMail.length = 0;
    const { donation, payment, expectedEmail } = await pendingDonationPayment(false);

    const first = await deliverSettlement(payment.providerRef, 100_000, `evt-a-${payment.providerRef}`);
    const ledgerAfterFirst = await prisma.ledgerEntry.count({ where: { paymentId: payment.id } });
    const second = await deliverSettlement(payment.providerRef, 100_000, `evt-b-${payment.providerRef}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID');
    expect(await prisma.receipt.count({ where: { donationId: donation.id } })).toBe(1);
    expect(ledgerAfterFirst).toBeGreaterThan(0);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(ledgerAfterFirst);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: { endsWith: payment.providerRef } } })).toBe(2);
    expect(sentMail.filter((m) => m.to === expectedEmail)).toHaveLength(1);
  });

  it('two different settlement events for one Trip Fee Payment confirm it once', async () => {
    sentMail.length = 0;
    const { registration, payment } = await pendingTripFeePayment();

    const first = await deliverSettlement(payment.providerRef, 500_000, `evt-a-${payment.providerRef}`);
    const ledgerAfterFirst = await prisma.ledgerEntry.count({ where: { paymentId: payment.id } });
    const second = await deliverSettlement(payment.providerRef, 500_000, `evt-b-${payment.providerRef}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe('CONFIRMED');
    expect(ledgerAfterFirst).toBeGreaterThan(0);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(ledgerAfterFirst);
    expect(
      await prisma.notification.count({ where: { userId: registration.volunteerId, type: 'registration_confirmed' } }),
    ).toBe(1);
    expect(sentMail).toHaveLength(0);
  });

  // A registered Donor's account address is where the Receipt goes; the
  // Donation carries no guest ciphertext at all.
  it('resends an account-holder Donation Receipt to the decrypted account email', async () => {
    const { donation, expectedEmail } = await pendingDonationPayment(false);
    const token = `tok-${process.pid}-${next()}`;
    await prisma.receipt.create({
      data: {
        donationId: donation.id,
        token,
        sentAt: new Date(Date.now() - 10 * 60 * 1000),
        lastSentAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    sentMail.length = 0;

    const res = await resend(new NextRequest(`http://localhost/api/receipts/${token}/resend`, { method: 'POST' }), {
      params: Promise.resolve({ token }),
    });

    expect(res.status).toBe(200);
    expect(sentMail.map((m) => m.to)).toEqual([expectedEmail]);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { token } })).resendCount).toBe(1);
  });

  // The same spread sat in the Receipt resend route's `include` (4e55f3b).
  it('resends a Guest Donation Receipt to the guest email decrypted from its ciphertext', async () => {
    const { donation, expectedEmail } = await pendingDonationPayment(true);
    const token = `tok-${process.pid}-${next()}`;
    await prisma.receipt.create({
      data: {
        donationId: donation.id,
        token,
        sentAt: new Date(Date.now() - 10 * 60 * 1000),
        lastSentAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    sentMail.length = 0;

    const res = await resend(new NextRequest(`http://localhost/api/receipts/${token}/resend`, { method: 'POST' }), {
      params: Promise.resolve({ token }),
    });

    expect(res.status).toBe(200);
    expect(sentMail.map((m) => m.to)).toContain(expectedEmail);
  });
});
