import { NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { activeCampaignCountsByFundraiser, resolveAbuseThresholds } from '@/lib/abuse-thresholds';

/**
 * GET /api/admin/scrutiny: what the anti-penyalahgunaan limits have actually
 * caught (prd-compliance 38, PRD §"Anti penyalahgunaan").
 *
 * Three lists and the limits themselves:
 *   - `auditMarkers`: Campaigns whose Cumulative Gross passed the audit limit
 *     (CONTEXT.md, Penanda Audit), with the Gross and the limit they passed;
 *   - `donationReviewMarkers`: single Donations flagged for an Admin
 *     (Penanda Donasi), newest first;
 *   - `fundraisersAtActiveLimit`: Fundraisers already running as many Active
 *     Campaigns as the limit allows, which is the list an Admin chases a Usage
 *     Report on once Usage Reports exist (prd-compliance 29).
 *
 * A read and nothing else. Every one of these rows was written by the System
 * at Settlement (src/lib/scrutiny.ts) or by a Verifier's decision; this route
 * cannot mark, dismiss, block or reverse any of them, so opening it changes
 * no Campaign. The limits come from the same resolver the settlement and the
 * approval path read, so the numbers on screen are the numbers in force.
 *
 * ADMIN only.
 */
export const GET = withAssignmentCheck(Assignment.ADMIN, async () => {
  const now = new Date();
  const [thresholds, auditMarkers, donationReviewMarkers, activeCounts] = await Promise.all([
    resolveAbuseThresholds(prisma),
    prisma.campaignAuditMarker.findMany({
      orderBy: { placedAt: "desc" },
      include: { campaign: { select: { id: true, title: true, slug: true } } },
    }),
    prisma.donationReviewMarker.findMany({
      orderBy: { flaggedAt: "desc" },
      include: { campaign: { select: { id: true, title: true, slug: true } } },
    }),
    activeCampaignCountsByFundraiser(prisma, { now }),
  ]);

  return NextResponse.json({
    thresholds,
    auditMarkers: auditMarkers.map((marker) => ({
      id: marker.id,
      campaignId: marker.campaignId,
      title: marker.campaign.title,
      slug: marker.campaign.slug,
      cumulativeGross: marker.cumulativeGross,
      threshold: marker.threshold,
      placedAt: marker.placedAt,
    })),
    donationReviewMarkers: donationReviewMarkers.map((marker) => ({
      id: marker.id,
      donationId: marker.donationId,
      campaignId: marker.campaignId,
      title: marker.campaign.title,
      slug: marker.campaign.slug,
      amount: marker.amount,
      threshold: marker.threshold,
      flaggedAt: marker.flaggedAt,
    })),
    fundraisersAtActiveLimit: [...activeCounts.entries()]
      .filter(([, activeCampaigns]) => activeCampaigns >= thresholds.activeCampaignsPerFundraiser)
      .map(([fundraiserId, activeCampaigns]) => ({ fundraiserId, activeCampaigns }))
      .sort((a, b) => b.activeCampaigns - a.activeCampaigns || a.fundraiserId.localeCompare(b.fundraiserId)),
  });
});
