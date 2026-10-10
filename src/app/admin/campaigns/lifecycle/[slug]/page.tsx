import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { effectiveStatus, SUSPENDABLE, URGENT_SETTABLE_FROM } from '@/lib/campaign-lifecycle';
import { CampaignStatusChangeAction, CancellationRequestStatus } from '@/generated/prisma/client';
import { CampaignStatusBadge } from '@/components/campaign/CampaignStatusBadge';
import { AdminCampaignLifecycleActions } from '@/components/admin/AdminCampaignLifecycleActions';

// Rendered per request: open Flags, Suspensions and Cancellation requests change.
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * Jakarta time whatever zone the server runs in, formatted here and not in the
 * client form so the browser has nothing of its own to format and hydrate
 * differently (same format as src/app/admin/platform-fee/page.tsx).
 */
function formatWhen(at: Date): string {
  return at.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB';
}

/**
 * One Campaign, for the Admin deciding its Suspension or its pending
 * Cancellation request (ticket 25; ADR 0015; CONTEXT.md, Suspension and
 * Cancellation). The form half of /admin/campaigns/lifecycle; that page
 * only lists.
 *
 * The Campaign row lock, the two-person rule on lifting a Suspension, and
 * "never Admin on your own Campaign" all live in the lifecycle module
 * (src/lib/campaign-lifecycle.ts) and are re-checked there on every submit
 * -- what this page reads here (`isOwnCampaign`, `suspendedBySameAdmin`) is
 * only so AdminCampaignLifecycleActions can say why up front, the same
 * choice the Payout detail page already makes for its own two-person rule.
 *
 * The Admin who imposed the current Suspension is looked up only when the
 * Campaign is effectively SUSPENDED -- the same log row liftSuspension
 * itself reads (the most recent SUSPENDED CampaignStatusChange), so this
 * page never disagrees with the command it is asking to run.
 *
 * rilis-1-benda 66 adds the open Flags (who raised each, and when), to be
 * dismissed here, and Urgent, to be set or cleared. Whether Urgent can be set
 * is asked of the lifecycle module's own list (URGENT_SETTABLE_FROM), as
 * `canSuspend` is of SUSPENDABLE. A Flag is not told to the Campaign's
 * Fundraiser, so an Admin who is also its Fundraiser is not handed the
 * Verifier's reason or name: they see the note that they cannot act here.
 */
export default async function AdminCampaignLifecyclePage({ params }: RouteContext) {
  const { slug } = await params;

  const session = await getServerSession();
  const actorId = session!.user!.id as string;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      lifecycleStatus: true,
      deadline: true,
      creatorId: true,
      isUrgent: true,
    },
  });
  if (!campaign) {
    notFound();
  }

  const now = new Date();
  const status = effectiveStatus(campaign, now);
  const isOwnCampaign = actorId === campaign.creatorId;

  const [openFlags, pendingCancellationRequest, latestSuspension] = await Promise.all([
    isOwnCampaign
      ? Promise.resolve([])
      : prisma.campaignFlag.findMany({
          where: { campaignId: campaign.id, resolution: null },
          select: { id: true, reason: true, createdAt: true, verifier: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
    prisma.cancellationRequest.findFirst({
      where: { campaignId: campaign.id, status: CancellationRequestStatus.PENDING },
      select: { id: true, reason: true, requestedBy: { select: { name: true } } },
    }),
    status === 'SUSPENDED'
      ? prisma.campaignStatusChange.findFirst({
          where: { campaignId: campaign.id, action: CampaignStatusChangeAction.SUSPENDED },
          orderBy: { createdAt: 'desc' },
          select: { actorId: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{campaign.title}</h1>
        <div className="mt-1">
          <CampaignStatusBadge status={status} />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <AdminCampaignLifecycleActions
          campaignSlug={campaign.slug}
          status={status}
          canSuspend={SUSPENDABLE.includes(status)}
          isOwnCampaign={isOwnCampaign}
          suspendedBySameAdmin={latestSuspension?.actorId === actorId}
          openFlags={openFlags.map((flag) => ({
            id: flag.id,
            reason: flag.reason,
            verifierName: flag.verifier.name,
            flaggedAtLabel: formatWhen(flag.createdAt),
          }))}
          isUrgent={campaign.isUrgent}
          canSetUrgent={URGENT_SETTABLE_FROM.includes(status)}
          pendingCancellationRequest={
            pendingCancellationRequest
              ? {
                  id: pendingCancellationRequest.id,
                  reason: pendingCancellationRequest.reason,
                  requestedByName: pendingCancellationRequest.requestedBy.name,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
