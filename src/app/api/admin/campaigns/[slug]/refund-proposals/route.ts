import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { proposeCampaignRefunds } from '@/lib/money/campaign-refund-proposals';

/**
 * POST /api/admin/campaigns/[slug]/refund-proposals: one Admin proposes a
 * Refund for every Payment of a Suspended or Cancelled Campaign whose money
 * has not left (PRD 7.2, Pemicu; ticket audit-2026-10-16/07).
 *
 * No body. The calling Admin is the requester of every Refund, so a different
 * Admin approves each and a third completes it. Idempotent: a second call
 * proposes nothing new. The answer counts what was created, what already
 * stood, and what was skipped with its reason, including the money that
 * already left (`paidOut`).
 *
 * ADMIN only, through the ADMIN assignment; anyone else gets 404.
 */
export const POST = withHiddenAssignmentCheck(Assignment.ADMIN, async (_req: NextRequest, context?: { params: Promise<{ slug: string }> }) => {
  const { slug } = await context!.params;
  const session = await getServerSession();
  const actorAdminId = session!.user!.id as string;

  const campaign = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  try {
    const result = await proposeCampaignRefunds(prisma, { campaignId: campaign.id, actorAdminId });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const refusal = domainErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});
