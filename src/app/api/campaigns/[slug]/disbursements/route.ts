import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { campaignNotFound, findViewableCampaign, withViewerCacheControl } from '@/lib/campaign-visibility-route';

// Rendered per request: an unapproved Campaign's answer depends on who asks
// (findViewableCampaign reads the session), which a statically cached route
// cannot do.
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // An unapproved Campaign is private to its Fundraiser, Verifiers and
    // Admins; anyone else gets the same 404 as a slug that never existed.
    const campaign = await findViewableCampaign(slug);
    if (!campaign) return campaignNotFound();

    // Only COMPLETED payouts are a public record of money that has actually
    // moved -- a draft or pending payout is not something this page can
    // answer questions about, so it is filtered out here rather than left to
    // the client to hide.
    const payouts = await prisma.payout.findMany({
      where: { campaignId: campaign.id, status: 'COMPLETED' },
      select: {
        id: true,
        amount: true,
        description: true,
        proofImage: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return withViewerCacheControl(NextResponse.json({
      disbursements: payouts,
    }), campaign);
  } catch (error) {
    console.error('Error fetching campaign disbursements:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 }
    );
  }
}
