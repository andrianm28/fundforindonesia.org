import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { listPrayersForModeration } from '@/lib/prayer-moderation';
import { prayerModerationRoute } from '@/lib/prayer-moderation-route';

/**
 * GET /api/moderasi/prayers?filter=visible|hidden&page=&limit= -- the
 * moderators' list of Prayers (PKS Pasal 3.7c). A Verifier or an Admin; anyone
 * else gets the 404 of a route that does not exist. It names the Campaign and
 * the text, never the Donor.
 */
export const GET = prayerModerationRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') ?? 'visible';
  if (filter !== 'visible' && filter !== 'hidden') {
    return NextResponse.json({ error: 'Filter tidak dikenal' }, { status: 400 });
  }
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));

  const result = await listPrayersForModeration(prisma, { filter, page, limit });

  const response = NextResponse.json({
    ...result,
    page,
    limit,
    totalPages: Math.ceil(result.total / limit),
  });
  // Staff-only and always current.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
});
