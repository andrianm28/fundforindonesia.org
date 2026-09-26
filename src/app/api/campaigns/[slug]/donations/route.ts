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
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const skip = (page - 1) * limit;

    // An unapproved Campaign is private to its Fundraiser, Verifiers and
    // Admins; anyone else gets the same 404 as a slug that never existed.
    const campaign = await findViewableCampaign(slug);
    if (!campaign) return campaignNotFound();

    const where = {
      campaignId: campaign.id,
      paymentStatus: 'confirmed',
    };

    const [donations, total] = await Promise.all([
      prisma.donation.findMany({
        where,
        select: {
          id: true,
          amount: true,
          isAnonymous: true,
          message: true,
          createdAt: true,
          donor: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.donation.count({ where }),
    ]);

    // Map donations to include donor name or "Anonim"
    const mappedDonations = donations.map((donation) => ({
      id: donation.id,
      amount: donation.amount,
      donorName: donation.isAnonymous ? 'Anonim' : (donation.donor?.name || 'Anonim'),
      message: donation.message,
      createdAt: donation.createdAt,
    }));

    return campaign.respond({
      donations: mappedDonations,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Error fetching campaign donations:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 }
    );
  }
}
