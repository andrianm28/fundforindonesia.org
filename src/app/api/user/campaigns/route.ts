import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { effectiveStatus } from '@/lib/campaign-lifecycle';
import { VerificationOutcome } from '@/generated/prisma/client';

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = 10;
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { creatorId: session.user.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        slug: true,
        title: true,
        coverImage: true,
        collectedAmount: true,
        targetAmount: true,
        lifecycleStatus: true,
        deadline: true,
        createdAt: true,
      },
    }),
    prisma.campaign.count({ where: { creatorId: session.user.id } }),
  ]);

  // The request each Submitted Campaign waits on (at most one is PENDING per
  // Campaign), so the page can offer to withdraw it.
  const pending = await prisma.verificationRequest.findMany({
    where: { campaignId: { in: rows.map((row) => row.id) }, outcome: VerificationOutcome.PENDING },
    select: { id: true, campaignId: true },
  });
  const pendingByCampaign = new Map(pending.map((request) => [request.campaignId, request.id]));

  // Effective, so an Active Campaign past its deadline reads as Expired
  // here just as on the public page.
  const now = new Date();
  const campaigns = rows.map(({ lifecycleStatus, deadline, ...campaign }) => ({
    ...campaign,
    lifecycleStatus: effectiveStatus({ lifecycleStatus, deadline }, now),
    pendingVerificationRequestId: pendingByCampaign.get(campaign.id) ?? null,
  }));

  return NextResponse.json({
    campaigns,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
