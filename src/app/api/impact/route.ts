import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { impactBreakdown, ImpactDoesNotReconcileError } from '@/lib/money/impact';

/**
 * GET /api/impact -- the Impact & Transparency breakdown (ticket 25; PRD
 * FFI-14), for any visitor, with no session and no assignment.
 *
 * The six lines are computed from the ledger by impactBreakdown
 * (src/lib/money/impact.ts). When they cannot be reconciled against the
 * collected figure -- which means money moved that no settled Payment
 * accounts for -- this answers 500 with an error code and no figures at all.
 * A visitor is better served by "the books do not add up, we are not showing
 * you numbers" than by six lines that quietly do not sum to the total above
 * them; the incident itself belongs in /api/admin/reconcile.
 */
export async function GET(req: NextRequest) {
  const location = req.nextUrl.searchParams.get('location');

  try {
    const breakdown = await impactBreakdown(prisma, { location });

    const response = NextResponse.json(breakdown);
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    if (error instanceof ImpactDoesNotReconcileError) {
      // The delta goes to the log, never to the response: it is exactly the
      // number this page refuses to publish.
      console.error(
        `[impact] refusing to serve the breakdown: ${error.message} (difference ${error.linesTotal - error.collected})`,
      );
      return NextResponse.json({ error: 'impact-tidak-rekonsiliasi' }, { status: 500 });
    }
    throw error;
  }
}
