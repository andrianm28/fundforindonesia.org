import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { formatRupiah } from '@/lib/utils/currency';
import { AdminManualContributionDecisionForm } from '@/components/admin/AdminManualContributionDecisionForm';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Menunggu persetujuan',
  APPROVED: 'Disetujui -- sudah masuk pembukuan',
  REJECTED: 'Ditolak',
  REVERSED: 'Dibalikkan',
};

/**
 * One Manual Contribution, for the Admin acting on it (ticket 26;
 * CONTEXT.md, Manual Contribution; PRD FFI-07c): record (elsewhere, by
 * /admin/manual-contributions/new) -> approve/reject, by a different Admin
 * -> reverse, by a third. The form half of /admin/manual-contributions,
 * which only lists.
 *
 * STATUS DECIDES THE FORM, NOT A ROLE CHECK HERE, the same choice
 * /admin/refunds/[id] and /admin/payouts/[id] make: PENDING gets the
 * approve/reject form (which itself refuses the recorder);
 * APPROVED gets the reverse form (which itself refuses the recorder and the
 * decider); REJECTED and REVERSED are read-only -- a decision already made.
 *
 * CAMPAIGN AND PROGRAM, THROUGH REAL RELATIONS. Unlike Payout/Refund,
 * ManualContribution.campaignId/programId carry actual Prisma relations, so
 * the subject's title is read with one .include() rather than a batched
 * lookup.
 */
export default async function AdminManualContributionDetailPage({ params }: RouteContext) {
  const { id } = await params;

  const session = await getServerSession();
  const actorId = session!.user!.id as string;

  const contribution = await prisma.manualContribution.findUnique({
    where: { id },
    include: {
      recordedBy: { select: { name: true } },
      decidedBy: { select: { name: true } },
      reversedBy: { select: { name: true } },
      campaign: { select: { title: true } },
      program: { select: { title: true } },
    },
  });
  if (!contribution) {
    notFound();
  }

  const subjectTitle = contribution.campaign?.title ?? contribution.program?.title ?? 'Tidak diketahui';

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{subjectTitle}</h1>
        <p className="mt-1 text-sm text-gray-500">{STATUS_LABEL[contribution.status] ?? contribution.status}</p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Jumlah</p>
          <p className="text-lg font-semibold text-gray-900">{formatRupiah(contribution.amount)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Dicatat oleh</p>
          <p className="text-lg font-semibold text-gray-900">{contribution.recordedBy.name}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
          <p className="text-xs text-gray-500">Bukti transfer</p>
          <p className="text-sm text-gray-900">{contribution.proofReference}</p>
        </div>

        {contribution.note && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Catatan</p>
            <p className="text-sm text-gray-900">{contribution.note}</p>
          </div>
        )}

        {contribution.decidedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">
              {contribution.status === 'REJECTED' ? 'Ditolak oleh' : 'Disetujui oleh'}
            </p>
            <p className="text-sm font-medium text-gray-900">{contribution.decidedBy?.name}</p>
            {contribution.decisionReason && contribution.status === 'REJECTED' && (
              <p className="mt-1 text-sm text-gray-500">{contribution.decisionReason}</p>
            )}
          </div>
        )}

        {contribution.reversedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Dibalikkan oleh</p>
            <p className="text-sm font-medium text-gray-900">{contribution.reversedBy?.name}</p>
            {contribution.decisionReason && (
              <p className="mt-1 text-sm text-gray-500">{contribution.decisionReason}</p>
            )}
          </div>
        )}
      </div>

      {(contribution.status === 'PENDING' || contribution.status === 'APPROVED') && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Tindakan</h2>
          <p className="mb-3 text-xs text-gray-500">
            Aturan dua orang (CONTEXT.md, Manual Contribution): Admin yang menyetujui atau menolak harus berbeda dari
            yang mencatat, dan Admin yang membalikkan harus Admin ketiga -- bukan yang mencatat maupun yang
            menyetujui.
          </p>
          <AdminManualContributionDecisionForm
            manualContributionId={contribution.id}
            status={contribution.status}
            actorId={actorId}
            recordedById={contribution.recordedById}
            decidedById={contribution.decidedById}
          />
        </div>
      )}
    </div>
  );
}
