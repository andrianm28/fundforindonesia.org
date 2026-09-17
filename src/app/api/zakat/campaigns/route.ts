import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '12', 10)));
    const skip = (page - 1) * limit;

    const where = {
      status: 'active',
      OR: [
        { category: 'zakat' },
        { category: 'kemanusiaan' },
      ],
    };

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        include: {
          creator: {
            select: {
              name: true,
              isVerified: true,
              verificationType: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaign.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    const response = NextResponse.json({
      campaigns,
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
    console.error('Error fetching zakat campaigns:', error);
    return NextResponse.json(
      { error: 'Gagal mengambil data campaign zakat' },
      { status: 500 }
    );
  }
}
