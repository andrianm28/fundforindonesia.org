import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { campaignNotFound, PRIVATE_CACHE_CONTROL } from '@/lib/campaign-visibility-route';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/campaigns/[slug]/donations -- the owning Fundraiser's list of
 * settled Donations on their own Campaign (ticket 73). Read-only.
 *
 * NON-OWNER GETS THE SAME 404 AS A MISSING SLUG, so the answer never tells a
 * stranger the Campaign exists (campaignNotFound). Only the creator may read
 * it; there is no Admin path here.
 *
 * PRIVACY. Same rows and the same name rule as the public list
 * (/api/campaigns/[slug]/donations): confirmed, non-sandbox Donations only,
 * and an anonymous Donor (or a Donation anonymised under FFI-16, which sets
 * isAnonymous) shows as "Anonim". Only id, amount, name and time are
 * selected: no email, phone, receipt token or Donor id is ever read, so none
 * can leak into the answer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { slug },
      select: { id: true, creatorId: true },
    });
    if (!campaign || campaign.creatorId !== session.user.id) return campaignNotFound();

    const { searchParams } = new URL(request.url);
    const page = Math.min(100_000, Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10) || 10));

    const where = {
      campaignId: campaign.id,
      paymentStatus: 'confirmed',
      payments: { none: { sandbox: true } },
    };

    const [donations, total] = await Promise.all([
      prisma.donation.findMany({
        where,
        select: {
          id: true,
          amount: true,
          isAnonymous: true,
          createdAt: true,
          donor: { select: { name: true } },
          guestName: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.donation.count({ where }),
    ]);

    const response = NextResponse.json({
      donations: donations.map((d) => ({
        id: d.id,
        amount: d.amount,
        donorName: d.isAnonymous ? 'Anonim' : d.donor?.name || d.guestName || 'Anonim',
        createdAt: d.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
    response.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
    return response;
  } catch (error) {
    console.error('Error fetching fundraiser donations:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server', status: 500 },
      { status: 500 },
    );
  }
}
