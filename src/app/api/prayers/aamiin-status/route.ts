import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readAamiinMarker } from '@/lib/aamiin';

const MAX_IDS = 50;

/**
 * GET /api/prayers/aamiin-status?ids=a,b,c -- which of these Prayers the
 * current visitor (signed in, or a guest with a valid cookie) already gave an
 * Aamiin, so the button can show the given state after a reload (PKS
 * pemenuhan 15). Says nothing about anyone else, and is never cached.
 */
export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);
  const headers = { 'Cache-Control': 'private, no-store' };

  const marker = ids.length ? await readAamiinMarker(request) : null;
  if (!marker) return NextResponse.json({ given: [] }, { headers });

  const rows = await prisma.aamiinMark.findMany({
    where: { marker, prayerId: { in: ids } },
    select: { prayerId: true },
  });
  return NextResponse.json({ given: rows.map((r) => r.prayerId) }, { headers });
}
