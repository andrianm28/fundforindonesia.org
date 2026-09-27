import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refuseUnlessFundraiserOrAdmin } from '@/lib/refusal-response';
import { effectiveStatus } from '@/lib/campaign-lifecycle';
import { mayViewCampaign } from '@/lib/campaign-visibility';
import { campaignNotFound } from '@/lib/campaign-visibility-route';

// Rendered per request: the answer depends on who asks (getServerSession),
// same as every other owner-only sub-resource of /api/campaigns/[slug].
export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[slug]/traffic-sources (ticket 24, "Traffic Source on
 * Donation"): "Counts per link are visible to the Fundraiser." Which shared
 * link produced Donations is not public campaign content the way the
 * donations list is, so this asks two questions in order: first the
 * Campaign visibility rule everyone else's GET consults (an unapproved
 * Campaign does not exist for anyone but its Fundraiser, Verifiers and
 * Admins -- campaignNotFound() either way, so a stranger cannot tell a
 * missing slug from one they may not see), then, only once the Campaign is
 * visible at all, the stricter owner-or-admin rule this analytics data
 * actually needs (a Verifier who may view an unapproved Campaign is not
 * thereby its Fundraiser).
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;

    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true, creatorId: true, lifecycleStatus: true, deadline: true },
    });
    if (!campaign) return campaignNotFound();

    const session = await getServerSession();
    const status = effectiveStatus(campaign, new Date());
    if (!mayViewCampaign({ status, fundraiserId: campaign.creatorId }, session?.user)) {
      return campaignNotFound();
    }

    const refusal = refuseUnlessFundraiserOrAdmin(
      { kind: 'campaign', ownerId: campaign.creatorId },
      session?.user ?? {},
    );
    if (refusal) return refusal;

    const grouped = await prisma.donation.groupBy({
      by: ['trafficSource'],
      where: { campaignId: campaign.id, paymentStatus: 'confirmed' },
      _count: { _all: true },
    });

    const sources = grouped.map((row) => ({
      source: row.trafficSource,
      count: row._count._all,
    }));

    return NextResponse.json({ sources });
  } catch (error) {
    console.error('Error fetching traffic sources:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 },
    );
  }
}
