import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { readUserEmail, requireFieldKeys } from '@/lib/contact-fields';
import { errorText, getMailer, type Mailer, type MailMessage } from '@/lib/mail';
import { escapeHtml } from '@/lib/mail/escape-html';
import {
  backoffAfterFailure,
  MAX_NOTIFICATION_ATTEMPTS,
  payloadAad,
} from '@/lib/mail/failed-queue';
import { NotificationNotFoundError, NotificationNotResendableError } from '@/lib/money/errors';
import { WEBHOOK_OUTCOMES_NEEDING_REVIEW } from '@/lib/money/payment-reconciliation';
import { publicUrl } from '@/lib/public-url';

export { MAX_NOTIFICATION_ATTEMPTS };

/**
 * The failed notification queue's runner side (PKS Pasal 8(2); the write side
 * is ./mail/failed-queue.ts, called by sendReportingFailure): retry with
 * backoff, the Admin's resend, the Admin's list, and the throttled email to the
 * Admins when something piles up.
 *
 * CONCURRENCY. Every send starts with a claim: one UPDATE that sets
 * `claimedUntil` on rows chosen by `FOR UPDATE SKIP LOCKED`, so two runners (two
 * containers, a cron overlapping a slow run, an Admin pressing resend during a
 * run) never hold the same row, and a send is never repeated because two
 * processes both read PENDING. The lease lapses on its own, so a runner that
 * dies mid-send does not strand the row; the worst case after a crash is one
 * repeated email, which is the right side to err on for a notification.
 *
 * Every result write is guarded the same way: `updateMany` where the row is
 * still claimable (PENDING or DEAD) AND `claimToken` is the token this runner's
 * claim set. A runner whose lease lapsed while it was stuck mid-send finds a
 * newer claim's token (or a SENT row) there, its write matches nothing, and it
 * cannot turn a SENT row back into PENDING (which would send a third time) or
 * overwrite the newer runner's outcome.
 *
 * Retention: SENT clears the sealed payload; the phase deletes SENT rows after
 * 30 days and DEAD rows after 90.
 *
 * Nothing here logs a body or an address: errors go through errorText, rows
 * are named by id.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long a claim holds a row; longer than any one SMTP send. */
const LEASE_MS = 10 * MINUTE;

/** Rows one run takes, so a backlog cannot make a 15-minute job run for an hour. */
const RETRY_BATCH = 50;

/**
 * Trouble older than this no longer starts an Admin email by itself: it is
 * still on the screens, but an unattended item must not mail every hour for a
 * week.
 */
const ALERT_WINDOW_MS = 24 * HOUR;

/** Unsent rows that count as "piling up" even though none is DEAD yet. */
const PENDING_PILE_UP = 10;

const ALERT_INTERVAL_MS = HOUR;

const DAY = 24 * HOUR;

/** SENT rows have nothing left to retry; they are kept this long for the Admin's questions, then deleted. */
const SENT_RETENTION_MS = 30 * DAY;

/** DEAD rows wait for an Admin this long (counted from the first failure), then are deleted. */
const DEAD_RETENTION_MS = 90 * DAY;

/**
 * SUPERSEDED: this runner's claim was replaced while it was sending (its lease
 * lapsed), so its outcome was not recorded; whoever holds the row now decides it.
 */
export type NotificationOutcome = 'SENT' | 'FAILED' | 'SUPERSEDED';

export interface NotificationRetryResult {
  attemptedCount: number;
  sentCount: number;
  failedCount: number;
}

type Claimed = { id: string };

/** One claim: the rows taken and the token that proves they are still ours. */
interface Claim {
  ids: string[];
  token: string;
}

/** Marks due PENDING rows as held by this runner, atomically, and returns their ids. */
async function claimDue(now: Date, limit: number): Promise<Claim> {
  const leaseEnd = new Date(now.getTime() + LEASE_MS);
  const token = randomUUID();
  const rows = await prisma.$queryRaw<Claimed[]>`
    UPDATE "FailedNotification"
    SET "claimedUntil" = ${leaseEnd}, "claimToken" = ${token}
    WHERE "id" IN (
      SELECT "id" FROM "FailedNotification"
      WHERE "status" = 'PENDING'
        AND "nextAttemptAt" <= ${now}
        AND ("claimedUntil" IS NULL OR "claimedUntil" <= ${now})
      ORDER BY "nextAttemptAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return { ids: rows.map((r) => r.id), token };
}

/** Marks one PENDING or DEAD row as held and returns the token, or null when it is sent or someone holds it. */
async function claimOne(id: string, now: Date): Promise<string | null> {
  const leaseEnd = new Date(now.getTime() + LEASE_MS);
  const token = randomUUID();
  const rows = await prisma.$queryRaw<Claimed[]>`
    UPDATE "FailedNotification"
    SET "claimedUntil" = ${leaseEnd}, "claimToken" = ${token}
    WHERE "id" = ${id}
      AND "status" IN ('PENDING', 'DEAD')
      AND ("claimedUntil" IS NULL OR "claimedUntil" <= ${now})
    RETURNING "id"`;
  return rows.length === 1 ? token : null;
}

/**
 * Sends one claimed row and records the result, only if the claim is still
 * ours (see the header). Never throws on a send problem: an unreadable payload
 * or an unbuildable Mailer is a failed attempt like a refused one, so a bad row
 * cannot stop the rest of the batch.
 */
async function attempt(
  id: string,
  token: string,
  now: Date,
  mailer: Mailer | undefined,
  retriedById: string | null,
): Promise<NotificationOutcome> {
  const row = await prisma.failedNotification.findUniqueOrThrow({ where: { id } });
  const stillOurs = { id, claimToken: token, status: { in: ['PENDING', 'DEAD'] as Array<'PENDING' | 'DEAD'> } };
  try {
    if (row.payloadCiphertext === null || row.payloadKeyId === null) throw new Error('the sealed message is gone');
    const message = JSON.parse(
      requireFieldKeys().decrypt(payloadAad(id), { ciphertext: row.payloadCiphertext, keyId: row.payloadKeyId }),
    ) as MailMessage;
    await (mailer ?? getMailer()).send(message);
  } catch (error) {
    const attempts = row.attempts + 1;
    const dead = attempts >= MAX_NOTIFICATION_ATTEMPTS;
    console.error(
      JSON.stringify({ event: 'mail_retry_failed', mail: row.kind, notificationId: id, attempts, dead, error: errorText(error) }),
    );
    const written = await prisma.failedNotification.updateMany({
      where: stillOurs,
      data: {
        attempts,
        status: dead ? 'DEAD' : 'PENDING',
        lastError: errorText(error).slice(0, 500),
        nextAttemptAt: new Date(now.getTime() + backoffAfterFailure(attempts)),
        claimedUntil: null,
        claimToken: null,
        ...(retriedById ? { lastRetriedById: retriedById } : {}),
      },
    });
    return written.count === 1 ? 'FAILED' : superseded(id);
  }
  const written = await prisma.failedNotification.updateMany({
    where: stillOurs,
    data: {
      status: 'SENT',
      sentAt: now,
      claimedUntil: null,
      claimToken: null,
      // A delivered message is not kept (data minimisation).
      payloadCiphertext: null,
      payloadKeyId: null,
      ...(retriedById ? { lastRetriedById: retriedById } : {}),
    },
  });
  return written.count === 1 ? 'SENT' : superseded(id);
}

function superseded(id: string): NotificationOutcome {
  console.error(JSON.stringify({ event: 'mail_retry_superseded', notificationId: id }));
  return 'SUPERSEDED';
}

/**
 * The scheduled retry: every PENDING row whose time has come, oldest first, up
 * to RETRY_BATCH. Success marks it SENT; failure backs off and counts, and the
 * MAX_NOTIFICATION_ATTEMPTS-th failure marks it DEAD, after which only an
 * Admin's resend tries it again.
 */
export async function retryDueNotifications(now: Date = new Date(), mailer?: Mailer): Promise<NotificationRetryResult> {
  const { ids, token } = await claimDue(now, RETRY_BATCH);
  const result: NotificationRetryResult = { attemptedCount: ids.length, sentCount: 0, failedCount: 0 };
  for (const id of ids) {
    try {
      const outcome = await attempt(id, token, now, mailer, null);
      if (outcome === 'SENT') result.sentCount++;
      else if (outcome === 'FAILED') result.failedCount++;
    } catch (error) {
      // The row could not even be read or written back (database trouble).
      // Its lease lapses by itself; the others in the batch still get their turn.
      result.failedCount++;
      console.error(JSON.stringify({ event: 'mail_retry_bookkeeping_failed', notificationId: id, error: errorText(error) }));
    }
  }
  return result;
}

/**
 * An Admin's "kirim ulang": tries the row now, whether it is PENDING or DEAD,
 * and records who pressed it. A row already SENT, or held by a runner or by
 * another Admin at this moment, is refused rather than sent twice.
 */
export async function resendFailedNotification(
  id: string,
  actorId: string,
  now: Date = new Date(),
  mailer?: Mailer,
): Promise<NotificationOutcome> {
  const token = await claimOne(id, now);
  if (!token) {
    const exists = await prisma.failedNotification.findUnique({ where: { id }, select: { id: true } });
    throw exists ? new NotificationNotResendableError(id) : new NotificationNotFoundError(id);
  }
  const outcome = await attempt(id, token, now, mailer, actorId);
  // Our lease lapsed mid-send and someone else took the row: same answer as
  // pressing the button on a row another runner holds.
  if (outcome === 'SUPERSEDED') throw new NotificationNotResendableError(id);
  return outcome;
}

/**
 * What /admin/notifikasi-gagal shows: unsent rows, oldest first, with the
 * counts the page headlines. Never the payload or the recipient: an Admin
 * finds the person through the ids in `context`.
 */
export async function listFailedNotifications() {
  const [rows, pending, dead] = await Promise.all([
    prisma.failedNotification.findMany({
      where: { status: { in: ['PENDING', 'DEAD'] } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        kind: true,
        context: true,
        status: true,
        attempts: true,
        lastError: true,
        nextAttemptAt: true,
        createdAt: true,
        lastRetriedById: true,
      },
    }),
    prisma.failedNotification.count({ where: { status: 'PENDING' } }),
    prisma.failedNotification.count({ where: { status: 'DEAD' } }),
  ]);
  return { rows, counts: { pending, dead } };
}

export type FailedNotificationList = Awaited<ReturnType<typeof listFailedNotifications>>;

/** The addresses of everyone holding ADMIN; one unreadable address skips that Admin only. */
async function adminEmails(): Promise<string[]> {
  const assignments = await prisma.userAssignment.findMany({
    where: { assignment: 'ADMIN' },
    select: { user: { select: { emailCiphertext: true, emailKeyId: true } } },
  });
  const emails: string[] = [];
  for (const { user } of assignments) {
    try {
      const email = readUserEmail(user);
      if (email) emails.push(email);
    } catch {
      // An address sealed under a key that is gone: nothing to send to.
    }
  }
  return emails;
}

/**
 * One short email to every Admin about one kind of trouble, at most once an
 * hour per `kind` (PKS pemenuhan 05). The slot is taken first with a single
 * guarded upsert, so concurrent runners cannot both send; if nobody could be
 * reached the slot is given back, so the next run tries again instead of
 * staying silent for an hour. The text carries counts and a link, never a
 * name, an address or a provider event id. Returns whether it was sent.
 */
export async function sendAdminAlert(
  kind: string,
  subject: string,
  text: string,
  now: Date = new Date(),
  options: { mailer?: Mailer; recipients?: string[] } = {},
): Promise<boolean> {
  const recipients = options.recipients ?? (await adminEmails());
  if (recipients.length === 0) return false;

  const earliest = new Date(now.getTime() - ALERT_INTERVAL_MS);
  const claimed = await prisma.$queryRaw<Array<{ kind: string }>>`
    INSERT INTO "AdminAlertThrottle" ("kind", "lastSentAt")
    VALUES (${kind}, ${now})
    ON CONFLICT ("kind") DO UPDATE SET "lastSentAt" = EXCLUDED."lastSentAt"
    WHERE "AdminAlertThrottle"."lastSentAt" <= ${earliest}
    RETURNING "kind"`;
  if (claimed.length === 0) return false;

  let delivered = 0;
  try {
    const mailer = options.mailer ?? getMailer();
    const html = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
    for (const to of recipients) {
      try {
        await mailer.send({ to, subject, text, html });
        delivered++;
      } catch (error) {
        console.error(JSON.stringify({ event: 'admin_alert_send_failed', alert: kind, error: errorText(error) }));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'admin_alert_not_configured', alert: kind, error: errorText(error) }));
  }
  if (delivered === 0) {
    await prisma.adminAlertThrottle.deleteMany({ where: { kind, lastSentAt: now } });
    return false;
  }
  return true;
}

export interface NotificationQueuePhaseResult extends NotificationRetryResult {
  /** The alert kinds that actually went out in this run. */
  alertsSent: string[];
  /** Rows deleted by the retention sweep (SENT after 30 days, DEAD after 90). */
  purgedCount: number;
}

/** Deletes rows past retention; a delivered message's payload is already gone, a DEAD one's goes with the row. */
async function purgeExpired(now: Date): Promise<number> {
  const deleted = await prisma.failedNotification.deleteMany({
    where: {
      OR: [
        { status: 'SENT', sentAt: { lt: new Date(now.getTime() - SENT_RETENTION_MS) } },
        { status: 'DEAD', createdAt: { lt: new Date(now.getTime() - DEAD_RETENTION_MS) } },
      ],
    },
  });
  return deleted.count;
}

/**
 * The scheduled-jobs phase (src/lib/scheduled-jobs.ts): retry what is due, then
 * tell the Admins at most once an hour per kind if
 *  - `notification_queue`: a notification is DEAD (or PENDING rows pile up), or
 *  - `webhook_review`: a webhook event needing review, or a charge with no
 *    Payment, arrived in the last day and nobody has closed it.
 * Also deletes rows past retention (purgeExpired).
 * Sent from this phase rather than from the webhook handler, so the handler's
 * hot path is untouched and the delay is one job interval (15 minutes).
 */
export async function runNotificationQueuePhase(
  now: Date = new Date(),
  mailer?: Mailer,
  options: { recipients?: string[] } = {},
): Promise<NotificationQueuePhaseResult> {
  const retry = await retryDueNotifications(now, mailer);
  const purgedCount = await purgeExpired(now);
  const since = new Date(now.getTime() - ALERT_WINDOW_MS);
  const alertsSent: string[] = [];
  const alert = { mailer, recipients: options.recipients };

  const [deadRecent, pending, deadTotal, webhookRecent, chargeRecent, webhookTotal, chargeTotal] = await Promise.all([
    prisma.failedNotification.count({ where: { status: 'DEAD', createdAt: { gte: since } } }),
    prisma.failedNotification.count({ where: { status: 'PENDING' } }),
    prisma.failedNotification.count({ where: { status: 'DEAD' } }),
    prisma.webhookEvent.count({
      where: { outcome: { in: [...WEBHOOK_OUTCOMES_NEEDING_REVIEW] }, resolvedAt: null, receivedAt: { gte: since } },
    }),
    prisma.chargeWriteFailure.count({ where: { resolvedAt: null, createdAt: { gte: since } } }),
    prisma.webhookEvent.count({ where: { outcome: { in: [...WEBHOOK_OUTCOMES_NEEDING_REVIEW] }, resolvedAt: null } }),
    prisma.chargeWriteFailure.count({ where: { resolvedAt: null } }),
  ]);

  if (deadRecent > 0 || pending >= PENDING_PILE_UP) {
    const text = [
      'Antrean notifikasi gagal butuh perhatian.',
      `Gagal permanen (menunggu kirim ulang): ${deadTotal}. Masih dicoba ulang: ${pending}.`,
      `Buka ${publicUrl('/admin/notifikasi-gagal')} untuk melihat dan mengirim ulang.`,
    ].join('\n');
    if (await sendAdminAlert('notification_queue', 'Notifikasi gagal menumpuk', text, now, alert)) {
      alertsSent.push('notification_queue');
    }
  }
  if (webhookRecent + chargeRecent > 0) {
    const text = [
      'Ada webhook atau charge pembayaran yang perlu ditinjau Admin.',
      `Event webhook belum selesai: ${webhookTotal}. Charge tanpa Payment belum selesai: ${chargeTotal}.`,
      `Buka ${publicUrl('/admin/reconciliation')} dan ikuti runbook rekonsiliasi pembayaran.`,
    ].join('\n');
    if (await sendAdminAlert('webhook_review', 'Webhook pembayaran perlu ditinjau', text, now, alert)) {
      alertsSent.push('webhook_review');
    }
  }
  return { ...retry, alertsSent, purgedCount };
}
