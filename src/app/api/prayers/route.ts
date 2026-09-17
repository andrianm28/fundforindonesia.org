import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const campaignSlug = searchParams.get('campaignSlug');

    const skip = (page - 1) * limit;

    // Build where clause - optionally filter by campaign slug
    const where: Prisma.PrayerWhereInput = campaignSlug
      ? { campaign: { slug: campaignSlug } }
      : {};

    const [prayers, total] = await Promise.all([
      prisma.prayer.findMany({
        where,
        include: {
          user: {
            select: {
              name: true,
              avatar: true,
            },
          },
          campaign: {
            select: {
              slug: true,
              title: true,
            },
          },
          donation: {
            select: {
              isAnonymous: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.prayer.count({ where }),
    ]);

    const mappedPrayers = prayers.map((prayer) => ({
      id: prayer.id,
      text: prayer.text,
      amiinCount: prayer.amiinCount,
      createdAt: prayer.createdAt,
      donorName: prayer.donation.isAnonymous
        ? 'Anonim'
        : prayer.user?.name || 'Anonim',
      donorAvatar: prayer.donation.isAnonymous
        ? null
        : prayer.user?.avatar || null,
      campaignSlug: prayer.campaign.slug,
      campaignTitle: prayer.campaign.title,
    }));

    const totalPages = Math.ceil(total / limit);

    const response = NextResponse.json({
      prayers: mappedPrayers,
      total,
      page,
      limit,
      totalPages,
    });

    response.headers.set(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300'
    );

    return response;
  } catch (error) {
    console.error('Error fetching prayers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prayers' },
      { status: 500 }
    );
  }
}
