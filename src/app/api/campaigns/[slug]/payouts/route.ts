import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withRoleCheck } from '@/lib/withRoleCheck';
import { refusalResponse, refuseUnlessFundraiser } from '@/lib/refusal-response';
import { requestPayout } from '@/lib/money/payouts';
import { releaseMaturedEscrow } from '@/lib/money/escrow';

const requestPayoutSchema = z.object({
  bankAccountId: z.string().min(1, 'Rekening bank harus dipilih'),
  amount: z.number().int('Jumlah harus berupa bilangan bulat').min(1, 'Jumlah pencairan harus lebih dari 0'),
  description: z.string().min(1, 'Keterangan harus diisi').max(500, 'Keterangan maksimal 500 karakter'),
});

/**
 * POST /api/campaigns/[slug]/payouts -- campaign owner requests a payout.
 *
 * withRoleCheck('CAMPAIGN_CREATOR') only proves the caller is A campaign
 * creator, not the creator of THIS campaign -- it gates on role and does not
 * pass the session to the handler, so getServerSession is called again here
 * and the Capacity judgement below (only this Campaign's Fundraiser) is what
 * actually stops one creator from draining another's campaign.
 *
 * The CAMPAIGN_CREATOR Role gate is legacy, kept until who may create a
 * Campaign or Volunteer Trip is decided (prd-compliance tickets 06-08).
 */
export const POST = withRoleCheck('CAMPAIGN_CREATOR', async (request: NextRequest, context: any) => {
  const { slug } = await context.params;
  const session = await getServerSession();
  const userId = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = requestPayoutSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }
  const { bankAccountId, amount, description } = parsed.data;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, creatorId: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }
  const refusal = refuseUnlessFundraiser({ kind: 'campaign', ownerId: campaign.creatorId }, session!.user!);
  if (refusal) return refusal;

  try {
    // Release every matured escrow hold for this campaign before checking
    // whether it has enough to pay out. There is no scheduler anywhere in
    // this repo, so this call is what makes the 7-day hold actually let go
    // of money -- without it, a settled donation would sit in ESCROW_HOLD
    // forever and campaignBalance() would never see it, no matter how long
    // ago it matured. It owns its own transactions (one per payment) and
    // runs before -- not inside -- requestPayout's transaction, so a
    // release that fails for one payment cannot roll back the request.
    await releaseMaturedEscrow({ type: 'campaign', id: campaign.id });

    const payout = await prisma.$transaction((tx) =>
      requestPayout(tx, {
        subject: { type: 'campaign', campaignId: campaign.id },
        requestedById: userId,
        bankAccountId,
        amount,
        description,
      }),
    );

    return NextResponse.json(
      {
        id: payout.id,
        campaignId: payout.campaignId,
        bankAccountId: payout.bankAccountId,
        amount: payout.amount,
        description: payout.description,
        status: payout.status,
        createdAt: payout.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    // Every refusal (Demo Campaign, Bank Account, balance, Campaign status)
    // carries its own code and answers its own status.
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('Error requesting payout:', error);
    return NextResponse.json({ error: 'Gagal mengajukan pencairan' }, { status: 500 });
  }
});
