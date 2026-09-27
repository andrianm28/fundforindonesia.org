import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { completePayout } from '@/lib/money/payouts';

const completePayoutSchema = z.object({
  proofImage: z.string().trim().min(1, 'Bukti transfer wajib dilampirkan'),
});

type RouteContext = { params: Promise<{ slug: string; id: string }> };

/**
 * POST /api/campaigns/[slug]/payouts/[id]/complete -- the second Admin
 * records that the money has moved.
 *
 * The other half of the two-person rule, and the step that closes the
 * money-out path: the Fundraiser requests, one Admin approves, a DIFFERENT
 * Admin transfers the money by hand in the provider's dashboard and comes
 * back here with proof (CONTEXT.md, Payout; ADR 0006; PRD FFI-07).
 *
 * withAssignmentCheck(Assignment.ADMIN) gates on the assignment only and
 * does not pass the session to the handler, so getServerSession is called
 * again here to learn who is completing -- that identity is what
 * completePayout compares against the approving Admin, and what it refuses
 * when it is the Campaign's own Fundraiser. The route does not re-derive
 * either rule: completePayout enforces them under the Campaign row lock,
 * which is what keeps them true against a concurrent Suspension or
 * Cancellation.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (request: NextRequest, context: RouteContext) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const completedById = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = completePayoutSchema.safeParse(body);
  if (!parsed.success) {
    // Asked for here as a field error so the form can point at the input; the
    // same rule is enforced again inside completePayout, because a caller
    // that is not this route must not be able to skip it.
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const payout = await prisma.payout.findUnique({ where: { id }, select: { campaignId: true } });
  if (!payout || payout.campaignId !== campaign.id) {
    return NextResponse.json({ error: 'Payout tidak ditemukan' }, { status: 404 });
  }

  try {
    // No payment provider is resolved here, exactly as at approval. The
    // transfer was made by hand in the provider's dashboard; this only
    // records it. See ADR 0006 and the doc comments on completePayout and
    // approvePayout.
    const updated = await completePayout(prisma, {
      payoutId: id,
      completedById,
      proofImage: parsed.data.proofImage,
    });

    return NextResponse.json({
      id: updated.id,
      campaignId: updated.campaignId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
      approvedAt: updated.approvedAt,
      completedById: updated.completedById,
      completedAt: updated.completedAt,
      proofImage: updated.proofImage,
    });
  } catch (error) {
    // Every refusal carries its own code and answers its own status:
    // TWO_PERSON_RULE when the approver tries to complete their own
    // approval, PAYOUT_NOT_ALLOWED_FOR_STATUS when a Suspension or
    // Cancellation landed in between, INVALID_PAYOUT_STATUS when the Payout
    // is not waiting.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error completing payout:', error);
    return NextResponse.json({ error: 'Gagal menandai pencairan selesai' }, { status: 500 });
  }
});
