import type { CampaignAuditMarker, DonationReviewMarker, Prisma } from "@/generated/prisma/client";
import { resolveAbuseThresholds } from "./abuse-thresholds";
import { raiseAmountReviewVerificationRequest, type VerificationRequestState } from "./campaign-lifecycle";

/**
 * What the platform does with the abuse thresholds (prd-compliance 38, PRD
 * §"Anti penyalahgunaan") at the one moment a threshold can be judged
 * honestly: the Settlement of a Donation.
 *
 * The numbers live in ./abuse-thresholds and the review they earn is raised
 * by the lifecycle module, because it is a Verification Request like any
 * other. This module is the join: it reads what just arrived, and asks for
 * the three marks that follow.
 *
 * WHY THE SETTLEMENT, AND NOT SOMEBODY LOOKING. Every one of these limits is
 * a comparison against money that has actually been collected, and a
 * Campaign's Cumulative Gross is zero while it waits to be approved. A rule
 * read only when a Verifier opens a queue would therefore never fire at all,
 * and one read only when an Admin thought to open a dashboard would fire
 * whenever that Admin got round to it -- which is precisely the timing an
 * abuser would pick. So the System evaluates at Settlement, in the
 * settlement's own transaction: the money and the marks it triggers commit
 * together, and skipping a Settlement because a threshold was passed is not
 * a thing anyone can choose to do.
 *
 * WHAT IS DELIBERATELY NOT HERE. Nothing is refused, held, delayed or
 * reversed. A Donation above the review threshold settles, keeps its Receipt
 * and its ledger entries, and is marked for an Admin; a Campaign above the
 * audit threshold keeps collecting; a Verifikasi Tambahan is a review, not a
 * hold. Refusing the money is what loses the platform the evidence, and the
 * one lever that does stop a Campaign is Suspension, which stays a person's
 * decision (ADR 0015). The gap this leaves is stated on the ticket: a
 * threshold is only noticed when money moves, so Gross that arrives by some
 * route this slice does not read (a Manual Contribution, prd-compliance 34)
 * is not judged here yet.
 */

export type ScrutinyDb = Prisma.TransactionClient;

/**
 * What the evaluation reads and writes, and nothing more: a transaction it is
 * meant to run inside, never a client of its own. The settlement owns the
 * transaction so that the money and the marks it triggers commit together
 * (see the module note).
 */

/** No such Donation: the Settlement is not one this platform recorded. */
export class DonationNotSettledForReviewError extends Error {
  constructor(readonly donationId: string) {
    super("Donation tidak ditemukan.");
    this.name = "DonationNotSettledForReviewError";
  }
}

export type ScrutinyOutcome = {
  /** The mark on this Donation itself, or null when it is an ordinary amount. */
  donationMarker: DonationReviewMarker | null;
  /** The Campaign's audit marker, existing or new, or null below the threshold. */
  auditMarker: CampaignAuditMarker | null;
  /** The Verifikasi Tambahan this Donation's arrival earned, or null. */
  amountReview: VerificationRequestState | null;
};

/**
 * Judges one just-settled Donation against the thresholds in force and
 * leaves behind whatever they call for. Called by the Settlement webhook
 * inside the settlement's transaction, after `collectedAmount` has been
 * incremented, so the Gross it reads is the Gross including this Donation.
 *
 * At most one Verifikasi Tambahan is ever raised per Campaign, and it is
 * raised by the Donation that crosses the threshold rather than by every
 * Donation above it: a Campaign collecting Rp10 juta at a time would
 * otherwise fill the Verifier's queue with one review per Donation, and the
 * one thing a queue full of identical entries destroys is attention. The
 * lifecycle module's own check under the Campaign row lock is what makes
 * that hold when two Donations settle at the same moment.
 *
 * The markers are upserts on their unique subject, so a Settlement retried
 * (prd-compliance 18) leaves one marker rather than several, and the audit
 * marker keeps the Gross and the time of the FIRST crossing rather than
 * being overwritten by whatever arrives next.
 */
export async function evaluateSettledDonationScrutiny(
  db: ScrutinyDb,
  params: { donationId: string; now?: Date }
): Promise<ScrutinyOutcome> {
  const { donationId } = params;
  const now = params.now ?? new Date();
  const donation = await db.donation.findUnique({
    where: { id: donationId },
    select: {
      id: true,
      amount: true,
      campaign: { select: { id: true, collectedAmount: true, isDemo: true } },
    },
  });
  if (!donation) throw new DonationNotSettledForReviewError(donationId);

  // A Demo Campaign's collectedAmount came from a seed file (prd-compliance
  // 26), so a figure invented at seed time must never raise a real marker
  // or put a fabricated Campaign in front of an Admin for review.
  if (donation.campaign.isDemo) {
    return { donationMarker: null, auditMarker: null, amountReview: null };
  }

  const thresholds = await resolveAbuseThresholds(db);

  const donationMarker =
    donation.amount > thresholds.donationReviewAmount
      ? await db.donationReviewMarker.upsert({
          where: { donationId: donation.id },
          create: {
            donationId: donation.id,
            campaignId: donation.campaign.id,
            amount: donation.amount,
            threshold: thresholds.donationReviewAmount,
            flaggedAt: now,
          },
          update: {},
        })
      : null;

  const cumulativeGross = donation.campaign.collectedAmount;
  const auditMarker =
    cumulativeGross > thresholds.campaignAuditGross
      ? await db.campaignAuditMarker.upsert({
          where: { campaignId: donation.campaign.id },
          create: {
            campaignId: donation.campaign.id,
            cumulativeGross,
            threshold: thresholds.campaignAuditGross,
            placedAt: now,
          },
          update: {},
        })
      : null;

  // Strictly above, the way the PRD words both money limits ("di atas Rp100
  // juta"), and raised by the Donation that carries the Campaign past the
  // line: at exactly the threshold nothing has been exceeded, and a later
  // Donation is only ever a later Donation.
  const amountReview =
    cumulativeGross > thresholds.campaignReviewGross &&
    cumulativeGross - donation.amount <= thresholds.campaignReviewGross
      ? await raiseAmountReviewVerificationRequest(db, {
          campaignId: donation.campaign.id,
          cumulativeGross,
          threshold: thresholds.campaignReviewGross,
          now,
        })
      : null;

  return { donationMarker, auditMarker, amountReview };
}
