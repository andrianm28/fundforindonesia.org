import { isBetaSandbox } from '@/lib/deploy-environment';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { campaignNotFound, findViewableCampaign } from '@/lib/campaign-visibility-route';

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
    //
    // usageReport carries only the report's public fields (ticket 22; PRD
    // FFI-07a: "tampil publik ... sejak dikirim"). Never submittedById or
    // disputedById: those name a person, and this route answers to anyone,
    // signed in or not.
    const payouts = await prisma.payout.findMany({
      // Real disbursements only, except while the beta marker is on, when the
      // simulated ones show too, each flagged `sandbox` so the page marks it UJI
      // (ticket 94). Once the marker is gone they are left out for good.
      where: { campaignId: campaign.id, status: 'COMPLETED', ...(isBetaSandbox() ? {} : { sandbox: false }) },
      select: {
        id: true,
        amount: true,
        description: true,
        proofImage: true,
        createdAt: true,
        sandbox: true,
        usageReport: {
          select: {
            id: true,
            narrative: true,
            lineItems: true,
            beneficiaryCount: true,
            photos: true,
            createdAt: true,
            disputedAt: true,
            disputedReason: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return campaign.respond({
      disbursements: payouts,
    });
  } catch (error) {
    console.error('Error fetching campaign disbursements:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 }
    );
  }
}
