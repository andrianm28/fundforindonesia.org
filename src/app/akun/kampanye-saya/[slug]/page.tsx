import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { effectiveStatus } from '@/lib/subject-guard';
import { todayWibDate } from '@/lib/utils/date';
import { SUBMITTABLE_STATUSES } from '@/lib/verification-submission';
import { CampaignEditForm } from '@/components/campaign/CampaignEditForm';
import { ChangeRequestForm } from '@/components/campaign/ChangeRequestForm';
import { CampaignCloseActions } from '@/components/campaign/CampaignCloseActions';
import { CampaignStatusBadge } from '@/components/campaign/CampaignStatusBadge';

// What this screen offers follows the Campaign's status, which changes under it.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * A Fundraiser's screen for one of their Campaigns (tickets 72, 65): the
 * edit form for a Draft or Rejected Campaign (PATCH /api/campaigns/[slug]),
 * for an Active one the change request for target and deadline (ticket 72),
 * and the two ways to end it: mark it Completed or ask for Cancellation
 * (ticket 65).
 *
 * Guarded on the server like the Payout and Documents screens beside it:
 * signed out goes to sign in, and a Campaign that is not this account's
 * answers 404, the same as one that does not exist. An Admin who does not own
 * the Campaign gets the same 404; Admins work through /admin.
 */
export default async function ManageCampaignPage({ params }: PageProps) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect('/login');
  }
  const { slug } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      story: true,
      coverImage: true,
      kind: true,
      targetAmount: true,
      category: true,
      deadline: true,
      collectingEntityId: true,
      creatorId: true,
      lifecycleStatus: true,
    },
  });
  if (!campaign || campaign.creatorId !== session.user.id) {
    notFound();
  }

  const status = effectiveStatus(campaign, new Date());
  const editable = SUBMITTABLE_STATUSES.includes(status);
  const canRequestChange = status === 'ACTIVE';

  const [category, waitingChange, updateCount, waitingCancellation] = await Promise.all([
    editable ? prisma.category.findUnique({ where: { slug: campaign.category }, select: { name: true } }) : null,
    canRequestChange
      ? prisma.verificationRequest.count({ where: { campaignId: campaign.id, outcome: 'PENDING', kind: 'CHANGE' } })
      : 0,
    canRequestChange ? prisma.campaignUpdate.count({ where: { campaignId: campaign.id } }) : 0,
    canRequestChange ? prisma.cancellationRequest.count({ where: { campaignId: campaign.id, status: 'PENDING' } }) : 0,
  ]);
  const deadline = campaign.deadline ? todayWibDate(campaign.deadline) : '';

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <Link href="/akun/kampanye-saya" className="text-white/80 text-xs hover:underline">
          Kembali ke Galang Dana Saya
        </Link>
        <div className="flex items-start justify-between gap-2 mt-2">
          <h1 className="text-white text-lg font-semibold">Kelola Campaign</h1>
          <CampaignStatusBadge status={status} />
        </div>
        <p className="text-white/80 text-sm mt-1 line-clamp-2">{campaign.title}</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 mt-4 space-y-4">
        {editable && (
          <CampaignEditForm
            slug={campaign.slug}
            initial={{
              kind: campaign.kind,
              title: campaign.title,
              story: campaign.story,
              deadline,
              coverImage: campaign.coverImage,
              collectingEntityId: campaign.collectingEntityId ?? '',
            }}
            targetAmount={campaign.targetAmount}
            categoryName={category?.name ?? campaign.category}
          />
        )}

        {canRequestChange && (
          <section className="bg-white rounded-xl shadow-xs p-4" aria-labelledby="change-request-heading">
            <h2 id="change-request-heading" className="text-sm font-semibold text-text mb-3">
              Ajukan perubahan target atau tenggat
            </h2>
            <ChangeRequestForm
              slug={campaign.slug}
              kind={campaign.kind}
              targetAmount={campaign.targetAmount}
              deadline={deadline}
              waiting={waitingChange > 0}
            />
          </section>
        )}

        {canRequestChange && (
          <CampaignCloseActions slug={campaign.slug} hasUpdate={updateCount > 0} cancellationPending={waitingCancellation > 0} />
        )}

        {!editable && !canRequestChange && (
          <p data-testid="manage-not-editable" className="bg-white rounded-xl shadow-xs p-4 text-sm text-text-secondary">
            Campaign dengan status ini tidak dapat diedit. Draft dan Campaign yang ditolak dapat diedit; Campaign
            yang sedang diperiksa Verifier harus ditarik dulu dari Galang Dana Saya.
          </p>
        )}
      </div>
    </div>
  );
}
