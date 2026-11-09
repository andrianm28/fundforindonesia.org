import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { requireFieldKeys } from '@/lib/contact-fields';
import type { MailMessage } from './types';

/**
 * The write side of the failed notification queue (PKS Pasal 8(2); schema:
 * FailedNotification). Kept apart from ../failed-notifications.ts, which sends
 * and so imports the Mailer, so that ./index.ts can call this without a cycle.
 */

/** Failed sends, the first one included, before a row is DEAD and waits for an Admin. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Wait after the Nth failed send before the next attempt; the last entry is the one after the 4th failure. */
const BACKOFF_MS = [5 * MINUTE, 15 * MINUTE, HOUR, 4 * HOUR];

export function backoffAfterFailure(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
}

/**
 * Mails that carry a credential the person can simply ask for again (a reset
 * link, a verification link). Queuing one would leave a live login token in the
 * database for hours after its owner gave up on it, and a stale link is worth
 * nothing to them; these stay log-only, as before.
 */
export const NOT_QUEUED_MAIL: ReadonlySet<string> = new Set([
  'password_reset',
  'email_verification',
  // The public receipt resend (POST /api/receipts/[token]/resend): the Donor is
  // waiting for the answer, is told it failed (502), and can press the button
  // again. A queued copy would later send a second receipt nobody asked for.
  'receipt_resend',
]);

/**
 * The additional authenticated data a row's payload is sealed with: the row's
 * own id, so a ciphertext copied onto another row (or sealed for another
 * purpose) does not open there.
 */
export function payloadAad(id: string): string {
  return `FailedNotification.payload:${id}`;
}

const MAX_ERROR_LENGTH = 500;

/**
 * Puts a refused message in the queue. Never throws and never returns the
 * message: it runs on a path that is already failing, and when the database or
 * the field keys are the thing that is down the caller's own log line is the
 * record. `error` must already be redacted (errorText in ./index.ts).
 */
export async function recordFailedNotification(
  message: MailMessage,
  report: { mail: string } & Record<string, string>,
  error: string,
  now: Date = new Date(),
): Promise<void> {
  const { mail: kind, ...context } = report;
  if (NOT_QUEUED_MAIL.has(kind)) return;
  try {
    const keys = requireFieldKeys();
    const id = randomUUID();
    const sealed = keys.encrypt(payloadAad(id), JSON.stringify(message));
    const recipient = keys.emailLookup(message.to);
    await prisma.failedNotification.create({
      data: {
        id,
        kind,
        context: JSON.stringify(context),
        recipientHmac: recipient.hmac,
        recipientKeyId: recipient.keyId,
        payloadCiphertext: sealed.ciphertext,
        payloadKeyId: sealed.keyId,
        lastError: error.slice(0, MAX_ERROR_LENGTH),
        nextAttemptAt: new Date(now.getTime() + backoffAfterFailure(1)),
      },
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.name : typeof cause;
    console.error(JSON.stringify({ event: 'mail_queue_write_failed', mail: kind, reason }));
  }
}
