import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { revealPayoutAccountNumber } from '@/lib/money/payout-reveal';

/**
 * POST /api/admin/payouts/[id]/reveal-account -- the explicit server action
 * that opens a Payout's account number for the Admin about to complete it
 * (ticket 89). The rules and the audit row live in revealPayoutAccountNumber.
 * POST, never GET, and `no-store`, so the number is not cached or prefetched;
 * it is never logged here.
 */
export const POST = withAssignmentCheck(
  Assignment.ADMIN,
  async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const revealedById = session!.user!.id as string;

    try {
      const accountNumber = await revealPayoutAccountNumber(prisma, { payoutId: id, revealedById });
      return NextResponse.json({ accountNumber }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      console.error('Error revealing payout account number for payout', id);
      return NextResponse.json({ error: 'Gagal membuka nomor rekening.' }, { status: 500 });
    }
  },
);
