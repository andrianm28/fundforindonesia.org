import type { PrismaClient } from '@/generated/prisma/client';
import { PaymentStatus } from '@/generated/prisma/client';

/**
 * Ticket 52: money that reached the payment provider must never be silently
 * dropped. This module names what the webhook decided about an event
 * (`WebhookEvent.outcome`) and records charges the provider holds but this
 * database has no Payment for (`ChargeWriteFailure`).
 *
 * Server-only: it takes a Prisma client. Never import it from a client component.
 */

export const WEBHOOK_OUTCOME = {
  /** A PENDING Payment settled the ordinary way. */
  SETTLED: 'SETTLED',
  /**
   * `paid` arrived for a Payment already EXPIRED. The money is real, so it is
   * settled and ledgered like any Settlement; a Trip Fee whose seat is gone is
   * then refunded in full by `refundLateSettlement` (tickets 40/43).
   */
  PAID_AFTER_EXPIRED: 'PAID_AFTER_EXPIRED',
  /** As above, for a Payment already FAILED. */
  PAID_AFTER_FAILED: 'PAID_AFTER_FAILED',
  /** A second, distinct event lost the race to settle the same Payment. */
  LOST_RACE: 'LOST_RACE',
  /** `paid` whose gross differs from Payment.amount: nothing booked, an Admin looks. */
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  /** A sibling Payment of the same Donation was PAID first: nothing booked, an Admin looks. */
  SIBLING_ALREADY_PAID: 'SIBLING_ALREADY_PAID',
  /** `paid` naming no Payment here (e.g. a ChargeWriteFailure): an Admin looks. */
  UNKNOWN_PAYMENT: 'UNKNOWN_PAYMENT',
  /**
   * A Trip Fee settled but its seat was gone and the automatic full refund
   * (`refundLateSettlement`) threw. The money is booked in the ledger and the
   * Volunteer is owed it back: an Admin searches this outcome. The stuck-refund
   * sweep (src/lib/volunteer/refund-sweep.ts) retries the same Payment on its
   * own; a row that stays here after a sweep round needs a manual Refund.
   */
  LATE_SETTLEMENT_REFUND_FAILED: 'LATE_SETTLEMENT_REFUND_FAILED',
  /** Anything else landing on a Payment that had already left PENDING; no money moved. */
  IGNORED_TERMINAL: 'IGNORED_TERMINAL',
} as const;

export type WebhookOutcome = (typeof WEBHOOK_OUTCOME)[keyof typeof WEBHOOK_OUTCOME];

/** Outcomes where money may sit at the provider with no booking: an Admin must act. */
export const WEBHOOK_OUTCOMES_NEEDING_REVIEW: readonly WebhookOutcome[] = [
  WEBHOOK_OUTCOME.AMOUNT_MISMATCH,
  WEBHOOK_OUTCOME.SIBLING_ALREADY_PAID,
  WEBHOOK_OUTCOME.UNKNOWN_PAYMENT,
  WEBHOOK_OUTCOME.LATE_SETTLEMENT_REFUND_FAILED,
];

const MAX_SANITIZED_ERROR_LENGTH = 200;

/**
 * An error reduced to what is safe to log or store: its name, an optional code,
 * and a message with emails, bearer tokens, `key=value` secrets, URL query
 * strings and long opaque strings masked. Provider and database errors can echo
 * request bodies, so the raw object or message must never be logged or stored.
 */
export function sanitizeError(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const rawCode = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? ` [${String(rawCode).slice(0, 40)}]` : '';
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(token|secret|key|password|authorization|signature)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[redacted]')
    .replace(/(https?:\/\/[^\s?]+)\?\S*/gi, '$1?[redacted]')
    .replace(/\b[A-Za-z0-9_\-+/=]{24,}\b/g, '[redacted]')
    .slice(0, MAX_SANITIZED_ERROR_LENGTH);
  return message ? `${name}${code}: ${message}` : `${name}${code}`;
}

/**
 * The outcome label for a `paid` event landing on a Payment in `status`, or
 * null when that status is not one a late `paid` can settle (PENDING settles
 * normally; PAID/REFUNDED are already booked).
 */
export function lateSettlementOutcome(status: PaymentStatus): WebhookOutcome | null {
  if (status === PaymentStatus.EXPIRED) return WEBHOOK_OUTCOME.PAID_AFTER_EXPIRED;
  if (status === PaymentStatus.FAILED) return WEBHOOK_OUTCOME.PAID_AFTER_FAILED;
  return null;
}

export interface ChargeWriteFailureParams {
  provider: string;
  providerRef: string;
  subjectType: 'donation' | 'registration';
  subjectId: string;
  amount: number;
  error: unknown;
}

/**
 * Called when `provider.createCharge` succeeded and the Payment write did not.
 * Writes a ChargeWriteFailure row so the charge can be cancelled or refunded at
 * the provider. Never throws: it runs on a path that is already failing, and if
 * the database is the thing that is down, the structured log line is the record.
 */
export async function recordChargeWriteFailure(
  db: Pick<PrismaClient, 'chargeWriteFailure'>,
  params: ChargeWriteFailureParams,
): Promise<void> {
  const errorMessage = sanitizeError(params.error);
  console.error(
    `[reconciliation] CHARGE WITHOUT PAYMENT: provider=${params.provider} ref=${params.providerRef} ${params.subjectType}=${params.subjectId} amount=${params.amount} -- cancel or refund at the provider: ${errorMessage}`,
  );
  try {
    await db.chargeWriteFailure.create({
      data: {
        provider: params.provider,
        providerRef: params.providerRef,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        amount: params.amount,
        errorMessage,
      },
    });
  } catch (err) {
    console.error(
      `[reconciliation] could not record the charge without a Payment (ref=${params.providerRef}); the line above is the only record: ${sanitizeError(err)}`,
    );
  }
}
