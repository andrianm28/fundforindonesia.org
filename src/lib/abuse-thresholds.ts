import {
  AbuseThresholdKind,
  CampaignStatus,
  type AbuseThreshold,
  type PrismaClient,
} from "@/generated/prisma/client";
import { effectiveStatus } from "./subject-guard";

/**
 * The four limits the platform watches itself against, and the only place
 * they are written down (prd-compliance 38, PRD §"Anti penyalahgunaan";
 * CONTEXT.md, Verifikasi Tambahan, Penanda Audit, Penanda Donasi).
 *
 *   - a Campaign's Cumulative Gross above Rp100 juta earns a Verifier's
 *     attention again (Verifikasi Tambahan);
 *   - above Rp500 juta the Campaign carries an audit marker (Penanda Audit);
 *   - a single Donation above Rp50 juta is pointed at for an Admin
 *     (Penanda Donasi) and is never blocked;
 *   - a Fundraiser may run three Active Campaigns before their first Usage
 *     Report (which no Campaign status in this schema carries yet: see the
 *     Comments on prd-compliance 38).
 *
 * Every one of those is a rupiah amount or a count of Campaigns compared
 * against money that has actually settled, so they belong together here and
 * nowhere else. They are deliberately NOT the same thing as the title
 * similarity an Admin sets for the duplicate hints (src/lib/duplicate-hints.ts,
 * prd-compliance 14): that is a `pg_trgm` score between two Campaigns,
 * compared when a Verifier opens a request, and it stays a separate table
 * with its own route. Two questions, two tables -- not one place to set
 * numbers and two to read them.
 *
 * Resolution is the append-only pattern PlatformFeeThreshold and
 * DuplicateSimilarityThreshold already use: the row with the latest `setAt`
 * for a kind is in force, and nothing is seeded, so with no row set the PRD's
 * own numbers apply. A threshold is a single read or a single insert here,
 * never part of a larger write, so callers pass the plain client (or a
 * transaction) with nothing opened around it.
 */

type ThresholdDb = Pick<PrismaClient, "abuseThreshold">;

/** The PRD's numbers, in rupiah, for an Admin who has set none of them. */
export const ABUSE_THRESHOLD_DEFAULTS = {
  campaignReviewGross: 100_000_000,
  campaignAuditGross: 500_000_000,
  donationReviewAmount: 50_000_000,
  activeCampaignsPerFundraiser: 3,
} as const;

/** The four limits in force right now, named the way the rules are named. */
export type AbuseThresholds = {
  /** Cumulative Gross on a Campaign above which a Verifier reviews it again. */
  campaignReviewGross: number;
  /** Cumulative Gross on a Campaign above which it carries an audit marker. */
  campaignAuditGross: number;
  /** One Donation above which an Admin is pointed at it. */
  donationReviewAmount: number;
  /** Active Campaigns a Fundraiser may run before their first Usage Report. */
  activeCampaignsPerFundraiser: number;
};

/** Which stored kind each named limit is read from. */
const KIND_BY_FIELD = {
  campaignReviewGross: AbuseThresholdKind.CAMPAIGN_REVIEW_GROSS,
  campaignAuditGross: AbuseThresholdKind.CAMPAIGN_AUDIT_GROSS,
  donationReviewAmount: AbuseThresholdKind.DONATION_REVIEW_AMOUNT,
  activeCampaignsPerFundraiser: AbuseThresholdKind.ACTIVE_CAMPAIGNS_PER_FUNDRAISER,
} as const;

export const ABUSE_THRESHOLD_KINDS = Object.values(AbuseThresholdKind) as AbuseThresholdKind[];

export class InvalidAbuseThresholdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAbuseThresholdError";
  }
}

/**
 * The four limits in force: each Admin's latest row for that kind, and the
 * PRD's number for a kind nobody has set. One read for all four rather than
 * four, because they are answered together everywhere they are used and a
 * half-resolved set -- one kind read a moment later than the others -- is a
 * limit nobody can explain.
 */
export async function resolveAbuseThresholds(db: ThresholdDb): Promise<AbuseThresholds> {
  const rows = await db.abuseThreshold.findMany({ orderBy: { setAt: "desc" } });
  const inForce = new Map<AbuseThresholdKind, number>();
  for (const row of rows) {
    // Rows come newest first, so the first row of a kind is the current one
    // and a later row of the same kind is history, not a competing setting.
    if (!inForce.has(row.kind)) inForce.set(row.kind, row.value);
  }
  return {
    campaignReviewGross: inForce.get(KIND_BY_FIELD.campaignReviewGross) ?? ABUSE_THRESHOLD_DEFAULTS.campaignReviewGross,
    campaignAuditGross: inForce.get(KIND_BY_FIELD.campaignAuditGross) ?? ABUSE_THRESHOLD_DEFAULTS.campaignAuditGross,
    donationReviewAmount:
      inForce.get(KIND_BY_FIELD.donationReviewAmount) ?? ABUSE_THRESHOLD_DEFAULTS.donationReviewAmount,
    activeCampaignsPerFundraiser:
      inForce.get(KIND_BY_FIELD.activeCampaignsPerFundraiser) ??
      ABUSE_THRESHOLD_DEFAULTS.activeCampaignsPerFundraiser,
  };
}

/**
 * An Admin sets one of the four limits (POST /api/admin/abuse-thresholds).
 *
 * An insert, never an update, like every other threshold in this repo: the
 * value a Donation was judged against stays readable after a later change,
 * and `setById`/`setAt` on the row are the "who and when" without a second
 * audit table.
 *
 * A limit is a whole rupiah amount, or for the Campaign count a plain count,
 * so a fraction is refused rather than rounded: Rp50.000.000,5 is not an
 * amount this platform can hold, and quietly rounding it would make the
 * limit in force differ from the one the Admin read on the panel.
 */
export async function setAbuseThreshold(
  db: ThresholdDb,
  params: {
    kind: AbuseThresholdKind;
    value: number;
    actorId: string;
    now?: Date;
  }
): Promise<AbuseThreshold> {
  const { kind, value } = params;
  if (!ABUSE_THRESHOLD_KINDS.includes(kind)) {
    throw new InvalidAbuseThresholdError(
      `Ambang tidak dikenal. Pilih salah satu dari: ${ABUSE_THRESHOLD_KINDS.join(", ")}.`
    );
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new InvalidAbuseThresholdError(
      "Ambang harus berupa bilangan bulat lebih besar dari 0: rupiah untuk ambang dana, jumlah Campaign untuk batas Campaign Active.",
    );
  }

  return db.abuseThreshold.create({
    data: { kind, value, setById: params.actorId, setAt: params.now ?? new Date() },
  });
}

/** The HTTP answer for a refusal from this module, or null for anything else. */
export function abuseThresholdErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvalidAbuseThresholdError) return { status: 400, error: error.message };
  return null;
}

/**
 * How many Active Campaigns each Fundraiser is running, for the limit that
 * counts them (PRD §"Anti penyalahgunaan": three before their first Usage
 * Report).
 *
 * ONE definition, two callers: the approval that would open a fourth
 * (campaign-lifecycle.ts) and the Admin's scrutiny view, so the number a
 * Verifier refuses a Campaign on and the number an Admin is shown cannot
 * disagree. Judged on the *effective* status, the way every other reader in
 * this repo judges it, so a Campaign stored Active whose deadline has passed
 * has already freed its slot and does not need the lazy expiry to have run
 * first.
 *
 * A Demo Campaign never counts: its row is fixture data (prd-compliance 26),
 * and fiction must not cost a real Fundraiser a real slot. A Fundraiser with
 * no Active Campaign is absent from the map rather than mapped to zero, so a
 * caller can tell "none" from "not asked about".
 *
 * `excludeCampaignId` is for the caller that is deciding the Campaign's own
 * fate: an approval must not count the Campaign it is about to open.
 * `fundraiserId` narrows the read to one Fundraiser, which is what the
 * approval path wants: counting every Active Campaign on the platform to
 * answer a question about one person would make the cost of a Verifier's click
 * grow with the size of the catalogue.
 */
export async function activeCampaignCountsByFundraiser(
  db: Pick<PrismaClient, "campaign">,
  params: { now?: Date; excludeCampaignId?: string; fundraiserId?: string }
): Promise<Map<string, number>> {
  const { now = new Date(), excludeCampaignId, fundraiserId } = params;
  const campaigns = await db.campaign.findMany({
    where: {
      lifecycleStatus: CampaignStatus.ACTIVE,
      isDemo: false,
      ...(fundraiserId === undefined ? {} : { creatorId: fundraiserId }),
    },
    select: { id: true, creatorId: true, lifecycleStatus: true, deadline: true },
  });
  const counts = new Map<string, number>();
  for (const campaign of campaigns) {
    if (campaign.id === excludeCampaignId) continue;
    if (effectiveStatus(campaign, now) !== CampaignStatus.ACTIVE) continue;
    counts.set(campaign.creatorId, (counts.get(campaign.creatorId) ?? 0) + 1);
  }
  return counts;
}
