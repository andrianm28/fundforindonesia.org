import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { CampaignLifecycleStatus } from "@/types/campaign";

/**
 * The Campaigns a Verifier should look at before passing one (prd-compliance
 * 14, PRD FFI-05): at most five existing Campaigns that resemble this one on
 * any of the three things the PRD names -- the same Fundraiser, a title the
 * trigram extension of Postgres calls similar enough, or the same beneficiary
 * name -- so a duplicate or a repeat fraud is caught before the Campaign is
 * published rather than after.
 *
 * The three matches are one SQL question rather than three queries because
 * they are one table: the first and the third are plain column comparisons,
 * and the second is `similarity()` from the `pg_trgm` extension. Reading them
 * separately would mean three round trips and three chances to disagree about
 * which five Campaigns came back. The extension is enabled by migration
 * (`CREATE EXTENSION IF NOT EXISTS pg_trgm`), never by this module: a database
 * that never ran the migration cannot answer this query at all, and saying so
 * loudly at deploy time beats a runtime fallback that silently matches less.
 */

/** How many Campaigns a Verifier is shown, at most. */
export const MAX_DUPLICATE_HINTS = 5;

/**
 * The title similarity above which two Campaigns count as alike, before an
 * Admin sets one (PRD FFI-05: "ambang 0,6"). A float, not a percentage:
 * `similarity()` returns 0 to 1.
 */
export const DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

/** Why a Campaign is a hint: the three things the PRD says to match on. */
export const DUPLICATE_HINT_REASONS = ["SAME_FUNDRAISER", "SIMILAR_TITLE", "SAME_BENEFICIARY"] as const;

export type DuplicateHintReason = (typeof DUPLICATE_HINT_REASONS)[number];

/** One existing Campaign a Verifier is shown, and why it resembles this one. */
export type DuplicateCampaignHint = {
  campaignId: string;
  slug: string;
  title: string;
  /** Where the hinted Campaign stands, so the Verifier can tell a live duplicate from a finished one. */
  lifecycleStatus: CampaignLifecycleStatus;
  /** Every match, not just the strongest, so the Verifier sees a full match is not a near one. */
  reasons: DuplicateHintReason[];
  /** The trigram score of the title, whatever else matched; 0 to 1. */
  titleSimilarity: number;
};

export class DuplicateCampaignNotFoundError extends Error {
  constructor(readonly campaignId: string) {
    super("Campaign tidak ditemukan.");
    this.name = "DuplicateCampaignNotFoundError";
  }
}

type HintedCampaign = {
  id: string;
  title: string;
  creatorId: string;
  beneficiaryName: string | null;
};

/** The slice of the client these reads need; a caller may pass the whole one. */
export type DuplicateHintsDb = Pick<PrismaClient, "campaign" | "duplicateSimilarityThreshold" | "$queryRaw">;

type RawHintRow = {
  id: string;
  slug: string;
  title: string;
  lifecycleStatus: string;
  reasons: string[] | null;
  titleSimilarity: number | null;
};

/**
 * The three matches, as one statement. Written to be readable in a psql log
 * rather than clever: the WHERE keeps every Campaign that matched anything,
 * and the select says which.
 *
 * A Campaign with no beneficiary name must not match another Campaign that
 * also has none, so the name reaches the statement as the empty string: an
 * absent name then compares '' against a NULL column, which is never true,
 * where passing NULL straight through would read as though it might be.
 */
function hintsQuery(campaign: HintedCampaign, threshold: number) {
  const beneficiary = campaign.beneficiaryName ?? "";
  return Prisma.sql`
    SELECT
      c."id",
      c."slug",
      c."title",
      c."lifecycleStatus",
      ARRAY_REMOVE(
        ARRAY[
          CASE WHEN c."creatorId" = ${campaign.creatorId} THEN 'SAME_FUNDRAISER' END,
          CASE WHEN c."beneficiaryName" = ${beneficiary} THEN 'SAME_BENEFICIARY' END,
          CASE WHEN similarity(c."title", ${campaign.title}) >= ${threshold} THEN 'SIMILAR_TITLE' END
        ],
        NULL
      ) AS "reasons",
      similarity(c."title", ${campaign.title}) AS "titleSimilarity"
    FROM "Campaign" c
    WHERE c."id" <> ${campaign.id}
      AND (
        c."creatorId" = ${campaign.creatorId}
        OR c."beneficiaryName" = ${beneficiary}
        OR similarity(c."title", ${campaign.title}) >= ${threshold}
      )
    ORDER BY
      (c."creatorId" = ${campaign.creatorId}) DESC NULLS LAST,
      (c."beneficiaryName" = ${beneficiary}) DESC NULLS LAST,
      similarity(c."title", ${campaign.title}) DESC NULLS LAST,
      c."createdAt" ASC,
      c."id" ASC
    LIMIT ${Prisma.raw(String(MAX_DUPLICATE_HINTS))}
  `;
}

/**
 * The up-to-five Campaigns that resemble `campaignId`, most alike first. The
 * Campaign itself is never one of them, whatever it matches against, and the
 * cap holds even if the statement is ever changed to ask for more.
 *
 * `threshold` overrides the Admin's setting, for a caller that has already
 * resolved it; left out, the latest setting applies, and with no setting at
 * all the PRD's 0.6.
 */
export async function findDuplicateCampaignHints(
  db: DuplicateHintsDb,
  params: { campaignId: string; threshold?: number }
): Promise<DuplicateCampaignHint[]> {
  const campaign = await db.campaign.findUnique({
    where: { id: params.campaignId },
    select: { id: true, title: true, creatorId: true, beneficiaryName: true },
  });
  if (!campaign) throw new DuplicateCampaignNotFoundError(params.campaignId);

  const threshold = params.threshold ?? (await resolveDuplicateSimilarityThreshold(db));
  const rows = await db.$queryRaw<RawHintRow[]>(hintsQuery(campaign, threshold));

  return rows
    .map((row) => toHint(row))
    .filter((hint): hint is DuplicateCampaignHint => hint !== null)
    .slice(0, MAX_DUPLICATE_HINTS);
}

/**
 * A row is a hint only if it matched something. The statement only returns
 * matching rows, so this is a guard against a shape change reaching a Verifier
 * as a Campaign that resembles nothing: an unrecognised reason is dropped
 * rather than shown, and a row left with no reason at all is not a hint.
 */
function toHint(row: RawHintRow): DuplicateCampaignHint | null {
  const reasons = (row.reasons ?? []).filter((reason): reason is DuplicateHintReason =>
    (DUPLICATE_HINT_REASONS as readonly string[]).includes(reason),
  );
  if (reasons.length === 0) return null;
  return {
    campaignId: row.id,
    slug: row.slug,
    title: row.title,
    // The column is the CampaignStatus enum, so this is that enum's value
    // arriving as text; raw SQL does not narrow it for us.
    lifecycleStatus: row.lifecycleStatus as CampaignLifecycleStatus,
    reasons,
    titleSimilarity: row.titleSimilarity ?? 0,
  };
}

/**
 * The similarity threshold in force now: the Admin's latest setting, or the
 * PRD's 0.6 when they have set none. Mirrors resolvePlatformFeeBasis, which
 * falls back to 0 bps rather than invent a rate -- here the PRD states the
 * default, so there is a value to fall back to.
 */
export async function resolveDuplicateSimilarityThreshold(db: Pick<PrismaClient, "duplicateSimilarityThreshold">) {
  const latest = await db.duplicateSimilarityThreshold.findFirst({ orderBy: { setAt: "desc" } });
  return latest?.threshold ?? DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD;
}

export class InvalidDuplicateSimilarityThresholdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDuplicateSimilarityThresholdError";
  }
}

/**
 * An Admin sets the threshold above which two titles count as alike (PRD
 * FFI-05: "ambang 0,6 diatur Admin"). Append-only, like
 * setPlatformFeeThreshold: always an insert, so `setById` and `setAt` on the
 * row are the "who and when" record, and the value a hint was matched under
 * stays readable after a later change.
 *
 * `threshold` is a `similarity()` score: above 0, at most 1. Zero is refused
 * as well as a score above 1, because it would make every Campaign a hint of
 * every other one -- a five-Campaign list that names the same five for
 * everyone, which is the opposite of what the Verifier is shown them for.
 */
export async function setDuplicateSimilarityThreshold(
  db: Pick<PrismaClient, "duplicateSimilarityThreshold">,
  params: { threshold: number; actorId: string; now?: Date }
) {
  const { threshold } = params;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new InvalidDuplicateSimilarityThresholdError(
      "Ambang kemiripan harus lebih besar dari 0 dan tidak lebih dari 1, misalnya 0.6.",
    );
  }

  return db.duplicateSimilarityThreshold.create({
    data: { threshold, setById: params.actorId, setAt: params.now ?? new Date() },
  });
}

/** The HTTP answer for a refusal from this module, or null for anything else. */
export function duplicateHintsErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof InvalidDuplicateSimilarityThresholdError) return { status: 400, error: error.message };
  if (error instanceof DuplicateCampaignNotFoundError) return { status: 404, error: error.message };
  return null;
}
