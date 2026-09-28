import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { recordPayoutBalanceShort } from '@/lib/money/payouts';

/**
 * POST /api/admin/payouts/[id]/balance-check -- an Admin other than the
 * Payout's requester records "sudah dicek, kurang": the provider balance
 * they read in the provider's dashboard, when it is short of the Payout's
 * amount (ticket 30; ticket 02's answer, second half; FFI-07).
 *
 * Lives under /api/admin/payouts/[id] rather than under the Campaign or
 * Trip's own payout tree (unlike approve/complete): recordPayoutBalanceShort
 * never touches the ledger or the Payout row's own campaignId/volunteerTripId
 * fields, so there is no subject slug to resolve here and no 404 to answer
 * for one -- PayoutNotFoundError already covers a Payout id that does not
 * exist. The DRAFT status check, the two-person rule and the "is it actually
 * short" judgement all live in the money layer, same as approvePayout.
 */
export const POST = withAssignmentCheck(
  Assignment.ADMIN,
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const checkedById = session!.user!.id as string;

    const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;

    try {
      const check = await recordPayoutBalanceShort(prisma, {
        payoutId: id,
        checkedById,
        provider: typeof body?.provider === 'string' ? body.provider : '',
        providerBalance: body?.providerBalance as number,
      });

      return NextResponse.json({
        id: check.id,
        payoutId: check.payoutId,
        provider: check.provider,
        recordedBalance: check.recordedBalance,
        checkedAt: check.checkedAt,
      });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      console.error('Error recording payout balance check:', error);
      return NextResponse.json({ error: 'Gagal mencatat saldo penyedia.' }, { status: 500 });
    }
  },
);
