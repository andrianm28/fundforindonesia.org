import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = 10;
  const skip = (page - 1) * limit;

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { creatorId: session.user.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        slug: true,
        title: true,
        coverImage: true,
        collectedAmount: true,
        targetAmount: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.campaign.count({ where: { creatorId: session.user.id } }),
  ]);

  return NextResponse.json({
    campaigns,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
