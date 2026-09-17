import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, name: true, slug: true, icon: true, order: true },
  });

  const response = NextResponse.json({ categories });
  response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return response;
}
