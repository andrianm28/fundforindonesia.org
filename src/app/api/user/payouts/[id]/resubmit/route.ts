import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refusalResponse } from '@/lib/refusal-response';
import { resubmitPayout } from '@/lib/money/payouts';

/**
 * POST /api/user/payouts/[id]/resubmit -- the Fundraiser answers a revision
 * request (PKS Pasal 4.5; pks-pemenuhan/12): REVISION_REQUESTED -> DRAFT, back
 * in the Admin's queue. Optional `note` and `description` replace the stored
 * ones; the supporting papers were uploaded meanwhile through POST
 * /api/documents with this Payout's id. Posts nothing.
 *
 * One route for a Campaign's and a Trip's Payout: resubmitPayout locks the
 * subject from the Payout row and asks the Capacity judgement itself (only the
 * subject's Fundraiser), so the route has no slug to resolve. Every refusal
 * (not the Fundraiser, wrong status, Campaign Suspended since) is the money
 * layer's, answered through refusalResponse.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;

  try {
    const updated = await resubmitPayout(prisma, {
      payoutId: id,
      requestedById: session.user.id as string,
      note: typeof body?.note === 'string' ? body.note : undefined,
      description: typeof body?.description === 'string' ? body.description : undefined,
    });

    return NextResponse.json({ id: updated.id, amount: updated.amount, status: updated.status });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error resubmitting payout:', error);
    return NextResponse.json({ error: 'Gagal mengajukan ulang pencairan' }, { status: 500 });
  }
}
