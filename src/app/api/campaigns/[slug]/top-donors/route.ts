import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { campaignNotFound, findViewableCampaign } from '@/lib/campaign-visibility-route';
import { topDonorsForCampaign } from '@/lib/top-donors';

// Rendered per request: an unapproved Campaign's answer depends on who asks.
export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[slug]/top-donors -- the "Donatur teratas" tab (PKS 3.7b):
 * the largest PAID Donations, an anonymous Donor shown as "Anonim" with no
 * detail that could identify them (src/lib/top-donors.ts).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const campaign = await findViewableCampaign(slug);
    if (!campaign) return campaignNotFound();

    return campaign.respond({ donors: await topDonorsForCampaign(prisma, campaign.id) });
  } catch (error) {
    console.error('Error fetching top donors:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 },
    );
  }
}
