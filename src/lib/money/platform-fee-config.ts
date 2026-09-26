import type { Kind, PlatformFeeScope, PrismaClient } from '@/generated/prisma/client';
import { BPS_DENOMINATOR, type PercentBps } from './platform-fee';

/**
 * Resolving and setting the Platform Fee rate and waiver threshold
 * (CONTEXT.md, Platform Fee; prd-compliance 17). Both PlatformFeeRule and
 * PlatformFeeThreshold are append-only: setting a new value inserts a row
 * rather than mutating one, so "who and when" is exactly setById/setAt on
 * that row, and a Payment that already froze its own platformFee (POST
 * /api/donations) never has to notice a later change.
 *
 * Takes a `PrismaClient` (or the narrow slice a caller actually needs), not
 * a `Prisma.TransactionClient` -- every call here is a single read or a
 * single insert, never part of a larger write that must commit atomically
 * with something else, so callers pass the plain `prisma` client directly
 * (as partner-organisations.ts's top-level commands do), with no
 * transaction to open around it.
 */

type ReadDb = Pick<PrismaClient, 'platformFeeRule' | 'platformFeeThreshold'>;
type WriteRuleDb = Pick<PrismaClient, 'platformFeeRule'>;
type WriteThresholdDb = Pick<PrismaClient, 'platformFeeThreshold'>;

export class InvalidPlatformFeeRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPlatformFeeRuleError';
  }
}

export interface PlatformFeeBasis {
  percentBps: PercentBps;
  thresholdAmount: number;
}

/**
 * The rate and waiver threshold in force for one Campaign right now:
 * Campaign override, then Category override, then Kind default -- first
 * match wins, scopes are never merged or averaged (prd-compliance 17). No
 * match at all resolves to 0: an Admin who has not set a rate yet takes no
 * fee, rather than this module inventing a percentage no ADR or ticket
 * states. Reads the LATEST row for each scope+key, since rules are
 * append-only (setPlatformFeeRule below) -- that is always the current one.
 */
export async function resolvePlatformFeeBasis(
  db: ReadDb,
  params: { kind: Kind; category: string; campaignId: string },
): Promise<PlatformFeeBasis> {
  const [campaignRule, categoryRule, kindRule, threshold] = await Promise.all([
    db.platformFeeRule.findFirst({
      where: { scope: 'CAMPAIGN', campaignId: params.campaignId },
      orderBy: { setAt: 'desc' },
    }),
    db.platformFeeRule.findFirst({
      where: { scope: 'CATEGORY', category: params.category },
      orderBy: { setAt: 'desc' },
    }),
    db.platformFeeRule.findFirst({
      where: { scope: 'KIND', kind: params.kind },
      orderBy: { setAt: 'desc' },
    }),
    db.platformFeeThreshold.findFirst({ orderBy: { setAt: 'desc' } }),
  ]);

  const percentBps = campaignRule?.percentBps ?? categoryRule?.percentBps ?? kindRule?.percentBps ?? 0;
  const thresholdAmount = threshold?.amount ?? 0;
  return { percentBps, thresholdAmount };
}

/**
 * Convenience wrapper over resolvePlatformFeeBasis for the common case: a
 * caller that already has a Campaign row in hand (POST /api/donations, GET
 * /api/campaigns/[slug], and the Campaign detail page all do). Kept as one
 * function so the three-field shape it destructures is spelled once, not
 * copied at every call site.
 */
export function resolvePlatformFeeBasisForCampaign(
  db: ReadDb,
  campaign: { id: string; kind: Kind; category: string },
): Promise<PlatformFeeBasis> {
  return resolvePlatformFeeBasis(db, { kind: campaign.kind, category: campaign.category, campaignId: campaign.id });
}

function assertValidPercentBps(percentBps: unknown): asserts percentBps is number {
  if (
    typeof percentBps !== 'number' ||
    !Number.isInteger(percentBps) ||
    percentBps < 0 ||
    percentBps > BPS_DENOMINATOR
  ) {
    throw new InvalidPlatformFeeRuleError(
      `percentBps harus bilangan bulat antara 0 dan ${BPS_DENOMINATOR} (0% - 100%).`,
    );
  }
}

/**
 * Sets a new Platform Fee rate for one scope: KIND (needs `kind`), CATEGORY
 * (needs `category`), or CAMPAIGN (needs `campaignId`). Always inserts --
 * never updates a prior rule for the same scope+key -- so every change
 * apply only to Donations made afterwards (Payments already froze their own
 * rate) and the row itself is the "who and when" record.
 */
export async function setPlatformFeeRule(
  db: WriteRuleDb,
  params: {
    scope: PlatformFeeScope;
    kind?: Kind | null;
    category?: string | null;
    campaignId?: string | null;
    percentBps: number;
    actorId: string;
  },
) {
  assertValidPercentBps(params.percentBps);

  if (params.scope === 'KIND' && !params.kind) {
    throw new InvalidPlatformFeeRuleError('scope KIND membutuhkan kind.');
  }
  if (params.scope === 'CATEGORY' && !params.category) {
    throw new InvalidPlatformFeeRuleError('scope CATEGORY membutuhkan category.');
  }
  if (params.scope === 'CAMPAIGN' && !params.campaignId) {
    throw new InvalidPlatformFeeRuleError('scope CAMPAIGN membutuhkan campaignId.');
  }

  return db.platformFeeRule.create({
    data: {
      scope: params.scope,
      kind: params.scope === 'KIND' ? params.kind! : null,
      category: params.scope === 'CATEGORY' ? params.category! : null,
      campaignId: params.scope === 'CAMPAIGN' ? params.campaignId! : null,
      percentBps: params.percentBps,
      setById: params.actorId,
    },
  });
}

/**
 * Sets a new Platform Fee waiver threshold. Same append-only pattern as
 * setPlatformFeeRule: always an insert, the row's setById/setAt is the
 * audit trail.
 */
export async function setPlatformFeeThreshold(db: WriteThresholdDb, params: { amount: number; actorId: string }) {
  if (!Number.isInteger(params.amount) || params.amount < 0) {
    throw new InvalidPlatformFeeRuleError('amount harus rupiah bulat, tidak negatif.');
  }

  return db.platformFeeThreshold.create({
    data: { amount: params.amount, setById: params.actorId },
  });
}

/** The HTTP answer for a refusal from this module, or null for anything else. */
export function platformFeeErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvalidPlatformFeeRuleError) return { status: 400, error: error.message };
  return null;
}
