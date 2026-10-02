import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const MAX_PAGE = 10_000;

const querySchema = z.object({
  page: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  ),
  limit: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.coerce.number().int().min(1).transform((n) => Math.min(50, n)).default(10),
  ),
});

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parameter page harus bilangan bulat 1-10000 dan limit bilangan bulat positif' },
      { status: 400 },
    );
  }
  const { page, limit } = parsed.data;
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
