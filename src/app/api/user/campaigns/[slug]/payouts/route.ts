import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { refuseUnlessFundraiser } from '@/lib/refusal-response';
import { PRIVATE_CACHE_CONTROL } from '@/lib/campaign-visibility-route';
import { campaignBalance, escrowBalance } from '@/lib/money/ledger';
import { currentSandboxStamp } from '@/lib/money/sandbox-mode';
import { effectiveStatus } from '@/lib/campaign-lifecycle';

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
 * IT ALSO SENDS THE CAMPAIGN'S EFFECTIVE STATUS, because the screen has a form
 * on it and the form has to know whether a Payout may be asked for at all.
 * The link on the Campaign list is already hidden outside Active, Expired and
 * Completed, but a Fundraiser who types this URL arrives anyway, and a form
 * that cannot tell is a form that collects a request the server will refuse.
 *
 * NOT A RELEASE PATH. This read never calls releaseMaturedEscrow. spec.md
 * puts the release on a schedule (runScheduledJobs) and keeps the lazy sweep
 * as a SECOND path -- the one at the top of the Payout REQUEST handler
 * (src/app/api/campaigns/[slug]/payouts/route.ts), which is the only place
 * money is about to be asked for. A GET that moved money would make how
 * quickly someone loaded a page a fact about the books, and a read that can
 * write is not a read. The consequence is stated on ticket 28 rather than
 * papered over: a matured hold is released on the request, not before it, so
 * the figure below can read lower than it will be a moment after submitting.
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
    // lifecycleStatus and deadline because the response carries the Campaign's
    // EFFECTIVE status (effectiveStatus below), which is what the screen needs
    // in order to decide whether a Payout may be asked for at all. Without it
    // the form is offered on a Suspended or Cancelled Campaign and the
    // Fundraiser only learns from the refusal.
    select: { id: true, creatorId: true, isDemo: true, lifecycleStatus: true, deadline: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign tidak ditemukan' }, { status: 404 });
  }

  const refusal = refuseUnlessFundraiser({ kind: 'campaign', ownerId: campaign.creatorId }, session.user);
  if (refusal) return refusal;

  // The mode this screen works in (ticket 94): while the beta marker is on it
  // is the simulation, with test money and test Payouts only; otherwise it is
  // real money only. The answer says which (`sandbox`), so the screen can label
  // every figure UJI instead of passing it off as real.
  const sandbox = currentSandboxStamp();
  const [escrowHold, available, payouts] = await prisma.$transaction(async (tx) =>
    Promise.all([
      escrowBalance(tx, campaign.id, sandbox),
      campaignBalance(tx, campaign.id, sandbox),

      // Every status, not only the COMPLETED ones the public Campaign page
      // shows (./api/campaigns/[slug]/disbursements). FFI-07 requires the
      // Fundraiser to see where their Payout stands throughout, and "menunggu
      // persetujuan Admin" is the state they spend the most time in. Scoped
      // to this Campaign alone, so one Fundraiser never sees another's.
      tx.payout.findMany({
        where: { campaignId: campaign.id, sandbox },
        select: {
          id: true,
          amount: true,
          description: true,
          status: true,
          createdAt: true,
          approvedAt: true,
          completedAt: true,
          // Ticket 22 (PRD FFI-07a): only its id and whether it was marked
          // disputed are needed to compute usageReportStatus below -- never
          // the report's own content, which this Fundraiser already wrote
          // and can read on the public Campaign page.
          usageReport: { select: { id: true, disputedAt: true } },
          // Ticket 30: only WHEN a DRAFT Payout was last checked, never the
          // provider or the balance itself -- owner decision 2026-09-28
          // says the Fundraiser sees "menunggu saldo penyedia, dicek
          // [tanggal]" and nothing about the figure a provider's dashboard
          // showed.
          balanceChecks: { select: { checkedAt: true }, orderBy: { checkedAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]),
  );

  // Whether each COMPLETED Payout still blocks the next one from being
  // requested (CONTEXT.md, Usage Report; @/lib/usage-reports.ts,
  // campaignBlockingUsageReport, which this mirrors read-only): 'missing' or
  // 'disputed' both block, 'submitted' does not. Null for a Payout that is
  // not yet COMPLETED -- the question does not apply to it yet.
  const payoutsWithUsageReportStatus = payouts.map(({ usageReport, balanceChecks, ...payout }) => ({
    ...payout,
    usageReportStatus:
      payout.status !== 'COMPLETED'
        ? null
        : !usageReport
          ? ('missing' as const)
          : usageReport.disputedAt
            ? ('disputed' as const)
            : ('submitted' as const),
    // ticket 30: resolved the moment the Payout leaves DRAFT (owner decision
    // 2026-09-28) -- an APPROVED or COMPLETED Payout shows its ordinary
    // status instead, whatever its check history holds, so this is null for
    // anything but a still-DRAFT Payout with at least one recorded check.
    shortCheckedAt:
      payout.status === 'DRAFT' && balanceChecks && balanceChecks.length > 0
        ? balanceChecks[0].checkedAt.toISOString()
        : null,
  }));

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

  // Ticket 17: the empty picker is one screen for two different people, and
  // today's sentence cannot tell them apart -- someone who has never added a
  // Bank Account, and someone who added one that is PENDING or was REJECTED
  // (ticket 16 decision 5 makes REJECTED permanent, so this is not a passing
  // state for them). Asked only when the picker is otherwise empty: a
  // Fundraiser with a verified account has nothing this distinction would
  // change, and the read would have no reader.
  const hasUnverifiedBankAccount =
    bankAccounts.length === 0
      ? (await prisma.bankAccount.count({ where: { ownerId: userId, verifiedAt: null } })) > 0
      : false;

  const response = NextResponse.json({
    // A Demo Campaign's numbers are fixture data with no ledger behind them
    // (CONTEXT.md, Demo Campaign). The screen needs to say so by name: a
    // balance of 0 alone reads as "not arrived yet" and sends the Fundraiser
    // hunting for a shortfall that does not exist.
    isDemo: campaign.isDemo,
    // The EFFECTIVE status, not the stored column: an Active Campaign past its
    // deadline is Expired, and the money layer is judged on that
    // (requirePayoutAllowed, in ./lib/subject-guard.ts). The screen asks the
    // same question of the same list
    // (PAYOUT_REQUESTABLE_STATUSES, ./lib/payout-requestable-statuses.ts) --
    // which is why it is sent, and why it is sent as the effective one.
    lifecycleStatus: effectiveStatus(
      { lifecycleStatus: campaign.lifecycleStatus, deadline: campaign.deadline },
      new Date(),
    ),
    escrowHold,
    campaignBalance: available,
    sandbox,
    payouts: payoutsWithUsageReportStatus,
    bankAccounts,
    hasUnverifiedBankAccount,
  });
  response.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
  return response;
}
