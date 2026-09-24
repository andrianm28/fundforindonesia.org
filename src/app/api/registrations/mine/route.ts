import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
  const skip = (page - 1) * limit;

  const where = { volunteerId: session.user.id as string };

  const [registrations, total] = await Promise.all([
    prisma.registration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        status: true,
        holdExpiresAt: true,
        createdAt: true,
        batch: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            status: true,
            trip: {
              select: { title: true, slug: true, coverImage: true },
            },
          },
        },
        payment: {
          select: { amount: true, method: true, status: true },
        },
      },
    }),
    prisma.registration.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    registrations: registrations.map((registration) => ({
      ...registration,
      isCompletedParticipation:
        registration.status === 'CONFIRMED' && registration.batch.status === 'COMPLETED',
    })),
    total,
    page,
    limit,
    totalPages,
  });
}
