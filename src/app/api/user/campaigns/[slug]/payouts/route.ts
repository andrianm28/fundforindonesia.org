import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refuseUnlessFundraiser } from '@/lib/refusal-response';
import { PRIVATE_CACHE_CONTROL } from '@/lib/campaign-visibility-route';
import { campaignBalance, escrowBalance } from '@/lib/money/ledger';
import { releaseMaturedEscrow } from '@/lib/money/escrow';

// Per request: the answer depends on who asks, and it reads the ledger.
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * GET /api/user/campaigns/[slug]/payouts -- the owning Fundraiser's own view
 * of the money on one of their Campaigns, and the Payouts already made
 * against it.
 *
 * Lives under /api/user rather than /api/campaigns because it is not a
 * public reading of a Campaign: it is one person's balance, their own Bank
 * Accounts, and their own Payout history, none of which the Campaign page or
 * any visitor may see. The Payout request itself is a Campaign action and
 * stays where it already is (POST /api/campaigns/[slug]/payouts).
 *
 * THE TWO FIGURES, AND WHY THEY ARE BOTH FROM THE LEDGER. `escrowHold` is
 * ESCROW_HOLD and `campaignBalance` is CAMPAIGN_BALANCE, each summed by the
 * ledger's own reader (./money/ledger.ts) scoped to this campaign's rows.
 * Never Campaign.collectedAmount: that is the lifetime-raised display
 * figure, which knows nothing about escrow, refunds, or money already
 * instructed out, and paying against it is how the same rupiah leaves
 * twice. `ledger.ts` calls surfacing escrowBalance an obligation on whoever
 * builds this screen rather than a nicety, and this is that screen.
 *
 * The lazy escrow sweep runs here for the same reason it runs at the top of
 * the Payout request handler (src/app/api/campaigns/[slug]/payouts/route.ts):
 * there is no scheduler calling runScheduledJobs in production yet (ticket
 * 45), so a matured hold would otherwise sit in ESCROW_HOLD and read as
 * unavailable for as long as nobody asked to withdraw. Running it before the
 * read is what makes the Campaign Balance shown here the same number a
 * request made a second later would be judged against.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;

  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id as string;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, creatorId: true, isDemo: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const refusal = refuseUnlessFundraiser({ kind: 'campaign', ownerId: campaign.creatorId }, session.user);
  if (refusal) return refusal;

  // Outside the transaction below, and for the same reason as in the request
  // handler: it owns its own per-payment transactions, so a release that
  // fails for one payment cannot roll back the read.
  await releaseMaturedEscrow({ type: 'campaign', id: campaign.id });

  const [escrowHold, available, payouts] = await prisma.$transaction(async (tx) =>
    Promise.all([
      escrowBalance(tx, campaign.id),
      campaignBalance(tx, campaign.id),

      // Every status, not only the COMPLETED ones the public Campaign page
      // shows (./api/campaigns/[slug]/disbursements). FFI-07 requires the
      // Fundraiser to see where their Payout stands throughout, and "menunggu
      // persetujuan Admin" is the state they spend the most time in. Scoped
      // to this Campaign alone, so one Fundraiser never sees another's.
      tx.payout.findMany({
        where: { campaignId: campaign.id },
        select: {
          id: true,
          amount: true,
          description: true,
          status: true,
          createdAt: true,
          approvedAt: true,
          completedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]),
  );

  // The picker offers exactly what requestPayout will accept: this person's
  // own accounts, and only the verified ones. An account whose verification
  // was revoked is not offered, so the form cannot build a request the server
  // refuses.
  //
  // The account NUMBER is never sent, in any form. It is stored only as a
  // ciphertext (ADR 0012), and decrypting it here to mask the middle digits
  // would put a readable number onto the wire and into any proxy log, for a
  // picker that only ever displays the bank and the account name. The Fundraiser
  // entered the number themselves and do not need to read it back to recognise
  // their own account; the Admin who instructs the transfer decrypts it at
  // that point, which is the moment ADR 0012 already accounts for.
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { ownerId: userId, verifiedAt: { not: null } },
    select: { id: true, bankCode: true, accountName: true },
    orderBy: { createdAt: 'asc' },
  });

  const response = NextResponse.json({
    // A Demo Campaign's numbers are fixture data with no ledger behind them
    // (CONTEXT.md, Demo Campaign). The screen needs to say so by name: a
    // balance of 0 alone reads as "not arrived yet" and sends the Fundraiser
    // hunting for a shortfall that does not exist.
    isDemo: campaign.isDemo,
    escrowHold,
    campaignBalance: available,
    payouts,
    bankAccounts,
  });
  response.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
  return response;
}
