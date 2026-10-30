import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientAddress } from '@/lib/client-ip';
import { guardRoute } from '@/lib/rate-limit-guard';

// Readiness beyond "the DB answers" (audit OPS-3). Kept apart from /api/health,
// which the CD smoke test and rollback poll and which must stay cheap. Only
// counts and booleans are returned: no ids, amounts or error text.
//
// Last scheduled-job run age is NOT reported: nothing in the repo records when
// runScheduledJobs ran (no table, no log row), so there is nothing to read.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const STALE_PENDING_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  // Unauthenticated and uncached, so bound it per caller; open when the
  // limiter is down, since a health probe must still answer.
  const refused = await guardRoute(
    { scope: 'health-deep', subject: clientAddress(request.headers), limit: 30, windowSeconds: 60, onUnavailable: 'open' },
    { limited: 'Terlalu banyak permintaan.' },
  );
  if (refused) return refused;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error('Deep health check: database query failed', error);
    return NextResponse.json({ ok: false, db: false }, { status: 503, headers: NO_STORE });
  }

  let pendingOver24h: number | null = null;
  try {
    pendingOver24h = await prisma.payment.count({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - STALE_PENDING_MS) } },
    });
  } catch (error) {
    console.error('Deep health check: pending payment count failed', error);
  }
  return NextResponse.json({ ok: true, db: true, payments: { pendingOver24h } }, { headers: NO_STORE });
}
