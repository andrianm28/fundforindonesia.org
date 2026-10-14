import type { EscrowHoldScope, PrismaClient } from '@/generated/prisma/client';
import { ESCROW_HOLD_DAYS } from './escrow';

/**
 * Resolving and setting the Escrow Hold length (CONTEXT.md, Escrow Hold; PRD
 * FFI-17; ticket 90). The length is an Admin setting, not a constant:
 * ESCROW_HOLD_DAYS (./escrow.ts) is only the fallback for a platform where no
 * Admin has ever set one. Append-only like platform-fee-config.ts: a change
 * inserts a row, and setById/setAt on it are the "who and when".
 *
 * The caller copies the resolved number into `Payment.escrowHoldDays` when it
 * creates the Payment and Settlement reads that copy, never this table, so a
 * change here moves no Payment that already exists.
 */

type ReadDb = Pick<PrismaClient, 'escrowHoldSetting'>;

/** Shortest hold an Admin may set: a Campaign for disaster relief may be shortened, never to zero. */
export const MIN_ESCROW_HOLD_DAYS = 1;
/** Longest hold an Admin may set: money stays locked from a Fundraiser for at most about a month. */
export const MAX_ESCROW_HOLD_DAYS = 30;

export class InvalidEscrowHoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEscrowHoldError';
  }
}

/**
 * The hold length a Payment created now would freeze: the Category override
 * when one is set, else the Admin default, else the ESCROW_HOLD_DAYS fallback.
 * First match wins, scopes are never merged (the Platform Fee order, minus the
 * Campaign scope). `category` is omitted for a Trip Fee, which has none.
 * Reads the LATEST row for each scope+key, since rows are append-only.
 */
export async function resolveEscrowHoldDays(db: ReadDb, params: { category?: string | null } = {}): Promise<number> {
  const [categoryRow, defaultRow] = await Promise.all([
    params.category
      ? db.escrowHoldSetting.findFirst({
          where: { scope: 'CATEGORY', category: params.category },
          orderBy: { setAt: 'desc' },
        })
      : Promise.resolve(null),
    db.escrowHoldSetting.findFirst({ where: { scope: 'DEFAULT' }, orderBy: { setAt: 'desc' } }),
  ]);
  return categoryRow?.days ?? defaultRow?.days ?? ESCROW_HOLD_DAYS;
}

function assertValidDays(days: unknown): asserts days is number {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < MIN_ESCROW_HOLD_DAYS || days > MAX_ESCROW_HOLD_DAYS) {
    throw new InvalidEscrowHoldError(
      `Lama Escrow Hold harus bilangan bulat hari antara ${MIN_ESCROW_HOLD_DAYS} dan ${MAX_ESCROW_HOLD_DAYS}.`,
    );
  }
}

/**
 * Sets a new Escrow Hold length: scope DEFAULT, or CATEGORY (needs
 * `category`). Always inserts, never updates, so the history is the table
 * itself; applies only to Payments created afterwards.
 */
export async function setEscrowHoldSetting(
  db: Pick<PrismaClient, 'escrowHoldSetting'>,
  params: { scope: EscrowHoldScope; category?: string | null; days: number; actorId: string },
) {
  assertValidDays(params.days);

  if (params.scope !== 'DEFAULT' && params.scope !== 'CATEGORY') {
    throw new InvalidEscrowHoldError("scope harus 'DEFAULT' atau 'CATEGORY'.");
  }
  const category = typeof params.category === 'string' ? params.category.trim() : '';
  if (params.scope === 'CATEGORY' && category === '') {
    throw new InvalidEscrowHoldError('scope CATEGORY membutuhkan category.');
  }

  return db.escrowHoldSetting.create({
    data: {
      scope: params.scope,
      category: params.scope === 'CATEGORY' ? category : null,
      days: params.days,
      setById: params.actorId,
    },
  });
}

/** The HTTP answer for a refusal from this module, or null for anything else. */
export function escrowHoldErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvalidEscrowHoldError) return { status: 400, error: error.message };
  return null;
}
