// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { Mailer, MailMessage } from '@/lib/mail';

/**
 * PKS pemenuhan 05 (Pasal 8(2)): the failed notification queue, against a REAL
 * Postgres. What is under test is a row claim (UPDATE ... FOR UPDATE SKIP
 * LOCKED) and a guarded upsert, which a JS mock would only echo back. Same
 * setup as stuck-refund-sweep.test.ts: a throwaway database migrated by
 * replaying every migration, `@/lib/prisma` mocked to a real client, and a
 * visible skip when TEST_DATABASE_URL is unset.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = 'prisma/migrations';

function databaseUrlFor(database: string): string {
  const [base] = DATABASE_URL!.split('?');
  return `${base.substring(0, base.lastIndexOf('/') + 1)}${database}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = new Date('2026-11-10T08:00:00.000Z');

const message: MailMessage = {
  to: 'donor.secret@example.test',
  subject: 'Bukti donasi',
  text: 'Tautan rahasia: https://example.test/receipts/TOKEN-abc123',
  html: '<p>Tautan rahasia</p>',
};

function mailerThat(outcomes: Array<'ok' | 'fail'>): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  let i = 0;
  return {
    name: 'test',
    sent,
    async send(m) {
      const outcome = outcomes[Math.min(i++, outcomes.length - 1)];
      if (outcome === 'fail') throw new Error(`550 mailbox ${m.to} unavailable`);
      sent.push(m);
    },
  };
}

describe.skipIf(!DATABASE_URL)('failed notification queue -- against real Postgres (PKS pemenuhan 05)', () => {
  if (!DATABASE_URL) {
    console.warn(
      '[failed notification queue] TEST_DATABASE_URL is not set: these tests are being SKIPPED, not passing. ' +
        "CI's `test` job sets it; ci/local.sh's `local_database` helper does too.",
    );
  }

  const databaseName = `failed_notification_queue_${process.pid}`;
  let prisma: PrismaClient;
  let mail: typeof import('@/lib/mail');
  let queue: typeof import('@/lib/failed-notifications');
  let adminId: string;

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
    mail = await import('@/lib/mail');
    queue = await import('@/lib/failed-notifications');

    adminId = `admin-${process.pid}`;
    await prisma.user.create({
      data: {
        id: adminId,
        name: 'Admin',
        emailHmac: `${adminId}-hmac`,
        emailHmacKeyId: 'k',
        emailCiphertext: `${adminId}-c`,
        emailKeyId: 'k',
      },
    });
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
    if (!DATABASE_URL) return;
    await prisma.failedNotification.deleteMany();
    await prisma.adminAlertThrottle.deleteMany();
    await prisma.webhookEvent.deleteMany();
    await prisma.chargeWriteFailure.deleteMany();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  async function enqueue(msg: MailMessage = message, kind = 'receipt', ctx: Record<string, string> = { donationId: 'd1' }) {
    const accepted = await mail.sendReportingFailure(msg, { mail: kind, ...ctx }, mailerThat(['fail']));
    expect(accepted).toBe(false);
    const rows = await prisma.failedNotification.findMany({ orderBy: { createdAt: 'desc' } });
    return rows[0];
  }

  describe('a failed send is queued', () => {
    it('stores the failure with kind, ids, attempts, and a redacted error', async () => {
      const row = await enqueue();

      expect(row).toMatchObject({ kind: 'receipt', status: 'PENDING', attempts: 1, sentAt: null });
      expect(JSON.parse(row.context)).toEqual({ donationId: 'd1' });
      expect(row.lastError).toContain('550 mailbox');
      expect(row.lastError).not.toContain('donor.secret@example.test');
    });

    it('keeps neither the address nor the body in the clear', async () => {
      const row = await enqueue();

      const everything = JSON.stringify(row);
      expect(everything).not.toContain('donor.secret@example.test');
      expect(everything).not.toContain('TOKEN-abc123');
      expect(everything).not.toContain('Bukti donasi');
      expect(row.recipientHmac).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not queue a mail that carries a credential link the person can simply ask for again', async () => {
      await mail.sendReportingFailure(message, { mail: 'password_reset', userId: 'u1' }, mailerThat(['fail']));
      await mail.sendReportingFailure(message, { mail: 'email_verification', userId: 'u1' }, mailerThat(['fail']));

      expect(await prisma.failedNotification.count()).toBe(0);
    });

    it('does not queue the public receipt resend, where the Donor waits for the answer and can retry', async () => {
      const accepted = await mail.sendReportingFailure(message, { mail: 'receipt_resend', donationId: 'd1' }, mailerThat(['fail']));

      expect(accepted).toBe(false);
      expect(await prisma.failedNotification.count()).toBe(0);
    });

    it('does not queue a mail the provider accepted', async () => {
      const accepted = await mail.sendReportingFailure(message, { mail: 'receipt', donationId: 'd1' }, mailerThat(['ok']));

      expect(accepted).toBe(true);
      expect(await prisma.failedNotification.count()).toBe(0);
    });
  });

  describe('retry', () => {
    it('sends a due row again, marks it SENT, and delivers the original message', async () => {
      const row = await enqueue();
      const mailer = mailerThat(['ok']);

      const result = await queue.retryDueNotifications(new Date(row.nextAttemptAt.getTime() + 1), mailer);

      expect(result).toMatchObject({ attemptedCount: 1, sentCount: 1, failedCount: 0 });
      expect(mailer.sent).toEqual([message]);
      const after = await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe('SENT');
      expect(after.sentAt).not.toBeNull();
      // Data minimisation: a delivered message is not kept.
      expect(after.payloadCiphertext).toBeNull();
      expect(after.payloadKeyId).toBeNull();
      expect(after.claimToken).toBeNull();
    });

    it('binds each row to its own sealed payload: the same ciphertext moved to another row does not open', async () => {
      const a = await enqueue({ ...message, subject: 'a' }, 'receipt', { donationId: 'da' });
      const b = await enqueue({ ...message, subject: 'b' }, 'receipt', { donationId: 'db' });
      await prisma.failedNotification.update({
        where: { id: b.id },
        data: { payloadCiphertext: a.payloadCiphertext, payloadKeyId: a.payloadKeyId },
      });
      const mailer = mailerThat(['ok']);

      const result = await queue.retryDueNotifications(new Date(Date.now() + 10 * HOUR), mailer);

      expect(result).toMatchObject({ attemptedCount: 2, sentCount: 1, failedCount: 1 });
      expect(mailer.sent.map((m) => m.subject)).toEqual(['a']);
    });

    it('leaves a row that is not due yet alone', async () => {
      const row = await enqueue();
      const mailer = mailerThat(['ok']);

      const result = await queue.retryDueNotifications(new Date(row.nextAttemptAt.getTime() - 1), mailer);

      expect(result.attemptedCount).toBe(0);
      expect(mailer.sent).toEqual([]);
    });

    it('backs off after each failed retry, and a SENT row is never sent again', async () => {
      const row = await enqueue();
      const mailer = mailerThat(['fail', 'fail', 'ok']);
      let now = new Date(row.nextAttemptAt.getTime() + 1);

      await queue.retryDueNotifications(now, mailer);
      const second = await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } });
      expect(second).toMatchObject({ status: 'PENDING', attempts: 2 });
      expect(second.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
      const firstGap = second.nextAttemptAt.getTime() - now.getTime();

      now = new Date(second.nextAttemptAt.getTime() + 1);
      await queue.retryDueNotifications(now, mailer);
      const third = await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } });
      expect(third.attempts).toBe(3);
      expect(third.nextAttemptAt.getTime() - now.getTime()).toBeGreaterThan(firstGap);

      now = new Date(third.nextAttemptAt.getTime() + 1);
      await queue.retryDueNotifications(now, mailer);
      expect((await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENT');

      await queue.retryDueNotifications(new Date(now.getTime() + 100 * HOUR), mailer);
      expect(mailer.sent).toHaveLength(1);
    });

    it('marks a row DEAD at the attempt limit and stops retrying it', async () => {
      const row = await enqueue();
      const mailer = mailerThat(['fail']);
      let now = new Date(row.nextAttemptAt.getTime() + 1);

      for (let i = 0; i < queue.MAX_NOTIFICATION_ATTEMPTS + 2; i++) {
        await queue.retryDueNotifications(now, mailer);
        const current = await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } });
        now = new Date(current.nextAttemptAt.getTime() + 1);
      }

      const dead = await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } });
      expect(dead).toMatchObject({ status: 'DEAD', attempts: queue.MAX_NOTIFICATION_ATTEMPTS });
      const result = await queue.retryDueNotifications(new Date(now.getTime() + 1000 * HOUR), mailer);
      expect(result.attemptedCount).toBe(0);
    });

    it('two runners at once send each row once', async () => {
      const rows = [];
      for (let i = 0; i < 6; i++) rows.push(await enqueue({ ...message, subject: `s${i}` }, 'receipt', { donationId: `d${i}` }));
      const now = new Date(Date.now() + 10 * HOUR);
      const a = mailerThat(['ok']);
      const b = mailerThat(['ok']);

      await Promise.all([queue.retryDueNotifications(now, a), queue.retryDueNotifications(now, b)]);

      const subjects = [...a.sent, ...b.sent].map((m) => m.subject).sort();
      expect(subjects).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
      expect(await prisma.failedNotification.count({ where: { status: 'SENT' } })).toBe(6);
    });

    it('does not take a row another runner still holds, and takes it once the lease lapses', async () => {
      const row = await enqueue();
      const now = new Date(row.nextAttemptAt.getTime() + 1);
      await prisma.failedNotification.update({
        where: { id: row.id },
        data: { claimedUntil: new Date(now.getTime() + 5 * MINUTE) },
      });
      const mailer = mailerThat(['ok']);

      expect((await queue.retryDueNotifications(now, mailer)).attemptedCount).toBe(0);
      expect((await queue.retryDueNotifications(new Date(now.getTime() + 6 * MINUTE), mailer)).sentCount).toBe(1);
    });

    /** A Mailer whose send waits until the test lets it finish: a runner stuck mid-send. */
    function stuckMailer(outcome: 'ok' | 'fail') {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const sent: MailMessage[] = [];
      const started = new Promise<void>((resolveStarted) => {
        (stuckMailer as unknown as { _s: () => void })._s = resolveStarted;
      });
      const mailer: Mailer = {
        name: 'stuck',
        async send(m) {
          (stuckMailer as unknown as { _s: () => void })._s();
          await gate;
          if (outcome === 'fail') throw new Error('550 timeout');
          sent.push(m);
        },
      };
      return { mailer, sent, release, started };
    }

    it('a runner whose lease lapsed cannot overwrite SENT with its late failure, and nothing sends a third time', async () => {
      const row = await enqueue();
      const due = new Date(row.nextAttemptAt.getTime() + 1);
      const slow = stuckMailer('fail');
      const late = queue.retryDueNotifications(due, slow.mailer);
      await slow.started;
      const fast = mailerThat(['ok']);

      // Lease (10 min) lapsed: another runner claims the row and delivers it.
      await queue.retryDueNotifications(new Date(due.getTime() + 11 * MINUTE), fast);
      expect((await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENT');

      slow.release();
      await late;

      const after = await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toMatchObject({ status: 'SENT', attempts: 1, payloadCiphertext: null });
      const third = mailerThat(['ok']);
      await queue.retryDueNotifications(new Date(due.getTime() + 100 * HOUR), third);
      expect(third.sent).toEqual([]);
      expect(fast.sent).toHaveLength(1);
    });

    it('a runner whose lease lapsed cannot overwrite the newer runner\'s failure either', async () => {
      const row = await enqueue();
      const due = new Date(row.nextAttemptAt.getTime() + 1);
      const slow = stuckMailer('ok');
      const late = queue.retryDueNotifications(due, slow.mailer);
      await slow.started;

      await queue.retryDueNotifications(new Date(due.getTime() + 11 * MINUTE), mailerThat(['fail']));
      slow.release();
      await late;

      // The late 'ok' did not mark it SENT or wipe the payload the newer runner's retry still needs.
      const after = await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toMatchObject({ status: 'PENDING', attempts: 2 });
      expect(after.payloadCiphertext).not.toBeNull();
    });

    it('a retry racing an Admin resend: the late retry cannot overwrite the resend\'s SENT', async () => {
      const row = await enqueue();
      const due = new Date(row.nextAttemptAt.getTime() + 1);
      const slow = stuckMailer('fail');
      const late = queue.retryDueNotifications(due, slow.mailer);
      await slow.started;
      const adminMailer = mailerThat(['ok']);

      const resendAt = new Date(due.getTime() + 11 * MINUTE);
      expect(await queue.resendFailedNotification(row.id, adminId, resendAt, adminMailer)).toBe('SENT');
      slow.release();
      await late;

      const after = await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toMatchObject({ status: 'SENT', lastRetriedById: adminId, attempts: 1, payloadCiphertext: null });
      const third = mailerThat(['ok']);
      await queue.retryDueNotifications(new Date(resendAt.getTime() + 100 * HOUR), third);
      expect(third.sent).toEqual([]);
    });

    it('counts a Mailer that cannot be built as a failed attempt, not a crash', async () => {
      const row = await enqueue();
      vi.stubEnv('MAIL_PROVIDER', 'sendgrid');
      try {
        const result = await queue.retryDueNotifications(new Date(row.nextAttemptAt.getTime() + 1));
        expect(result).toMatchObject({ attemptedCount: 1, failedCount: 1 });
      } finally {
        vi.unstubAllEnvs();
      }
      expect((await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } })).attempts).toBe(2);
    });
  });

  describe('Admin resend', () => {
    it('sends a DEAD row now, records who did it, and marks it SENT', async () => {
      const row = await enqueue();
      await prisma.failedNotification.update({ where: { id: row.id }, data: { status: 'DEAD', attempts: 5 } });
      const mailer = mailerThat(['ok']);

      const result = await queue.resendFailedNotification(row.id, adminId, T0, mailer);

      expect(result).toBe('SENT');
      expect(mailer.sent).toEqual([message]);
      expect(await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        status: 'SENT',
        lastRetriedById: adminId,
      });
    });

    it('keeps a DEAD row DEAD when the resend fails too', async () => {
      const row = await enqueue();
      await prisma.failedNotification.update({ where: { id: row.id }, data: { status: 'DEAD', attempts: 5 } });

      const result = await queue.resendFailedNotification(row.id, adminId, T0, mailerThat(['fail']));

      expect(result).toBe('FAILED');
      expect(await prisma.failedNotification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        status: 'DEAD',
        lastRetriedById: adminId,
      });
    });

    it('refuses a row that is already SENT, and a row that does not exist', async () => {
      const row = await enqueue();
      await prisma.failedNotification.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: T0 } });
      const mailer = mailerThat(['ok']);

      await expect(queue.resendFailedNotification(row.id, adminId, T0, mailer)).rejects.toMatchObject({
        code: 'NOTIFICATION_NOT_RESENDABLE',
      });
      await expect(queue.resendFailedNotification('nope', adminId, T0, mailer)).rejects.toMatchObject({
        code: 'NOTIFICATION_NOT_FOUND',
      });
      expect(mailer.sent).toEqual([]);
    });

    it('two Admins pressing resend at once send one email', async () => {
      const row = await enqueue();
      const mailer = mailerThat(['ok']);

      const results = await Promise.allSettled([
        queue.resendFailedNotification(row.id, adminId, T0, mailer),
        queue.resendFailedNotification(row.id, adminId, T0, mailer),
      ]);

      expect(mailer.sent).toHaveLength(1);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('retention', () => {
    const DAY = 24 * HOUR;

    async function aged(status: 'SENT' | 'DEAD', ageDays: number) {
      const row = await enqueue();
      const at = new Date(T0.getTime() - ageDays * DAY);
      await prisma.failedNotification.update({
        where: { id: row.id },
        data: {
          status,
          createdAt: at,
          ...(status === 'SENT' ? { sentAt: at, payloadCiphertext: null, payloadKeyId: null } : {}),
        },
      });
      return row.id;
    }

    it('purges SENT rows older than 30 days and DEAD rows older than 90 days, and keeps everything younger', async () => {
      const oldSent = await aged('SENT', 31);
      const freshSent = await aged('SENT', 29);
      const oldDead = await aged('DEAD', 91);
      const freshDead = await aged('DEAD', 89);
      const pending = await enqueue();
      await prisma.failedNotification.update({
        where: { id: pending.id },
        data: { createdAt: new Date(T0.getTime() - 200 * DAY), nextAttemptAt: new Date(T0.getTime() + 100 * DAY) },
      });

      const result = await queue.runNotificationQueuePhase(T0, mailerThat(['ok']), { recipients: [] });

      expect(result.purgedCount).toBe(2);
      const left = (await prisma.failedNotification.findMany()).map((r) => r.id).sort();
      expect(left).toEqual([freshSent, freshDead, pending.id].sort());
      expect(left).not.toContain(oldSent);
      expect(left).not.toContain(oldDead);
    });
  });

  describe('Admin list', () => {
    it('lists unsent rows with no address and no body, oldest first, and counts them by status', async () => {
      const first = await enqueue();
      await enqueue(message, 'campaign_update', { updateId: 'u1' });
      await prisma.failedNotification.update({ where: { id: first.id }, data: { status: 'DEAD' } });

      const view = await queue.listFailedNotifications();

      expect(view.counts).toEqual({ pending: 1, dead: 1 });
      expect(view.rows.map((r) => r.kind)).toEqual(['receipt', 'campaign_update']);
      expect(JSON.stringify(view.rows)).not.toContain('donor.secret@example.test');
      expect(JSON.stringify(view.rows)).not.toContain('payloadCiphertext');
    });
  });

  describe('Admin alert throttle', () => {
    it('mails the Admins once per hour per kind, however many runners ask', async () => {
      const mailer = mailerThat(['ok']);
      const to = ['a@example.test'];
      const sendAll = () => queue.sendAdminAlert('notification_queue', 'Antrean menumpuk', 'ringkas', T0, { mailer, recipients: to });

      const results = await Promise.all([sendAll(), sendAll(), sendAll()]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(mailer.sent).toHaveLength(1);
    });

    it('mails again after an hour, and a different kind is not held back by the first', async () => {
      const mailer = mailerThat(['ok']);
      const opts = { mailer, recipients: ['a@example.test'] };

      await queue.sendAdminAlert('notification_queue', 's', 't', T0, opts);
      expect(await queue.sendAdminAlert('notification_queue', 's', 't', new Date(T0.getTime() + 59 * MINUTE), opts)).toBe(false);
      expect(await queue.sendAdminAlert('webhook_review', 's', 't', new Date(T0.getTime() + 59 * MINUTE), opts)).toBe(true);
      expect(await queue.sendAdminAlert('notification_queue', 's', 't', new Date(T0.getTime() + 61 * MINUTE), opts)).toBe(true);
      expect(mailer.sent).toHaveLength(3);
    });

    it('gives the slot back when the alert itself could not be sent, so the next run tries again', async () => {
      const opts = { recipients: ['a@example.test'] };

      expect(await queue.sendAdminAlert('notification_queue', 's', 't', T0, { ...opts, mailer: mailerThat(['fail']) })).toBe(false);
      expect(await queue.sendAdminAlert('notification_queue', 's', 't', T0, { ...opts, mailer: mailerThat(['ok']) })).toBe(true);
    });

    it('does not claim the slot when there is nobody to tell', async () => {
      const mailer = mailerThat(['ok']);

      expect(await queue.sendAdminAlert('notification_queue', 's', 't', T0, { mailer, recipients: [] })).toBe(false);
      expect(await prisma.adminAlertThrottle.count()).toBe(0);
    });
  });

  describe('the scheduled phase', () => {
    it('retries what is due, then alerts the Admins once about DEAD rows and unclosed webhook events', async () => {
      const row = await enqueue();
      await prisma.failedNotification.update({
        where: { id: row.id },
        data: { status: 'DEAD', attempts: 5, createdAt: T0 },
      });
      await prisma.webhookEvent.create({
        data: {
          provider: 'sumopod',
          merchantEntity: 'YAYASAN',
          providerEventId: `evt-${process.pid}-1`,
          payload: {},
          outcome: 'AMOUNT_MISMATCH',
          receivedAt: T0,
          processedAt: T0,
        },
      });
      const mailer = mailerThat(['ok']);

      const first = await queue.runNotificationQueuePhase(T0, mailer, { recipients: ['a@example.test'] });
      const second = await queue.runNotificationQueuePhase(new Date(T0.getTime() + 15 * MINUTE), mailer, {
        recipients: ['a@example.test'],
      });

      expect(first.alertsSent.sort()).toEqual(['notification_queue', 'webhook_review']);
      expect(second.alertsSent).toEqual([]);
      const bodies = mailer.sent.map((m) => m.subject + m.text).join('\n');
      expect(bodies).not.toContain('donor.secret@example.test');
      expect(bodies).not.toContain('evt-');
    });

    it('sends nothing when the queue and the webhook list are clean', async () => {
      const mailer = mailerThat(['ok']);

      const result = await queue.runNotificationQueuePhase(T0, mailer, { recipients: ['a@example.test'] });

      expect(result.alertsSent).toEqual([]);
      expect(mailer.sent).toEqual([]);
    });
  });

  describe('webhook "tandai selesai"', () => {
    let reconciliation: typeof import('@/lib/money/payment-reconciliation');

    async function reviewEvent(outcome = 'AMOUNT_MISMATCH') {
      return prisma.webhookEvent.create({
        data: {
          provider: 'sumopod',
          merchantEntity: 'YAYASAN',
          providerEventId: `evt-${process.pid}-${Math.random()}`,
          payload: {},
          outcome,
          receivedAt: T0,
          processedAt: T0,
        },
      });
    }

    beforeAll(async () => {
      if (!DATABASE_URL) return;
      reconciliation = await import('@/lib/money/payment-reconciliation');
    });

    it('records who closed it, when, and the note, and takes it off the queue', async () => {
      const event = await reviewEvent();

      await reconciliation.resolveWebhookEvent(prisma, {
        eventId: event.id,
        actorId: adminId,
        note: '  Refund penuh di dashboard Sumopod  ',
        now: T0,
      });

      expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
        resolvedAt: T0,
        resolvedById: adminId,
        resolutionNote: 'Refund penuh di dashboard Sumopod',
        outcome: 'AMOUNT_MISMATCH',
      });
      expect((await reconciliation.listReconciliationQueue(prisma)).webhookEvents).toEqual([]);
    });

    it('refuses an empty note, an event that needs no review, one already closed, and one that does not exist', async () => {
      const event = await reviewEvent();
      const settled = await reviewEvent('SETTLED');
      const close = (eventId: string, note = 'sudah') =>
        reconciliation.resolveWebhookEvent(prisma, { eventId, actorId: adminId, note, now: T0 });

      await expect(close(event.id, '   ')).rejects.toMatchObject({ code: 'WEBHOOK_RESOLUTION_INVALID' });
      await expect(close(settled.id)).rejects.toMatchObject({ code: 'WEBHOOK_EVENT_NOT_OPEN' });
      await close(event.id);
      await expect(close(event.id)).rejects.toMatchObject({ code: 'WEBHOOK_EVENT_NOT_OPEN' });
      await expect(close('nope')).rejects.toMatchObject({ code: 'WEBHOOK_EVENT_NOT_FOUND' });
    });

    it('two Admins closing at once close it once', async () => {
      const event = await reviewEvent();

      const results = await Promise.allSettled([
        reconciliation.resolveWebhookEvent(prisma, { eventId: event.id, actorId: adminId, note: 'pertama', now: T0 }),
        reconciliation.resolveWebhookEvent(prisma, { eventId: event.id, actorId: adminId, note: 'kedua', now: T0 }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });
});
