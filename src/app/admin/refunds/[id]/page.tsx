import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { formatRupiah } from '@/lib/utils/currency';
import { loadRefundSubject } from '@/lib/refund-subject-lookup';
import { REFUND_STATUS_LABEL } from '@/lib/refund-status-label';
import { AdminRefundApproveForm } from '@/components/admin/AdminRefundApproveForm';
import { AdminRefundCompleteForm } from '@/components/admin/AdminRefundCompleteForm';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * One Refund, for the Admin acting on it: create → approve (ticket 23;
 * CONTEXT.md, Refund). Rilis 1's narrowed scope -- only REQUESTED gets an
 * action, the wider RefundStatus machine (AwaitingDonorDetails, Processing,
 * Completed, Rejected, Failed) stays in the schema for a later rilis. The
 * form half of /admin/refunds, which only lists.
 *
 * TWO SUBJECTS, RESOLVED WITHOUT AN .include(). A Refund's Payment names a
 * Campaign or a Volunteer Trip, never both (assertExactlyOnePaymentSubject),
 * so its title and slug come from refund-subject-lookup.ts's batched-free
 * single lookup -- the same shape the queue page repeats for many rows.
 *
 * STATUS DECIDES THE FORM, NOT A ROLE CHECK HERE. REQUESTED gets the
 * approve form (which itself refuses the requester); APPROVED gets the
 * complete form (ticket 31, which itself refuses both the requester and
 * the approver); anything else (COMPLETED and, later, the rest of the
 * machine) gets a read-only summary.
 */
export default async function AdminRefundDetailPage({ params }: RouteContext) {
  const { id } = await params;

  const session = await getServerSession();
  const actorId = session!.user!.id as string;

  const refund = await prisma.refund.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      completedBy: { select: { name: true } },
      payment: {
        select: {
          amount: true,
          donation: { select: { campaignId: true } },
          registration: { select: { batch: { select: { tripId: true } } } },
        },
      },
    },
  });
  if (!refund) {
    notFound();
  }

  const subject = await loadRefundSubject(prisma, refund);
  if (!subject) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{subject.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{REFUND_STATUS_LABEL[refund.status]}</p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Jumlah Refund</p>
          <p className="text-lg font-semibold text-gray-900">{formatRupiah(refund.amount)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Diajukan oleh</p>
          <p className="text-lg font-semibold text-gray-900">{refund.requestedBy.name}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
          <p className="text-xs text-gray-500">Alasan</p>
          <p className="text-sm text-gray-900">{refund.reason}</p>
        </div>

        {refund.approvedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Disetujui oleh</p>
            <p className="text-sm font-medium text-gray-900">{refund.approvedBy?.name}</p>
          </div>
        )}

        {refund.completedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Diselesaikan oleh</p>
            <p className="text-sm font-medium text-gray-900">{refund.completedBy?.name}</p>
          </div>
        )}
      </div>

      {refund.status === 'REQUESTED' && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Tindakan</h2>
          <p className="mb-3 text-xs text-gray-500">
            Aturan dua orang (CONTEXT.md, Refund): Admin yang menyetujui harus berbeda dari yang mengajukan.
          </p>
          <AdminRefundApproveForm
            refundId={refund.id}
            subject={{ type: subject.type, slug: subject.slug }}
            actorId={actorId}
            requestedById={refund.requestedById}
          />
        </div>
      )}

      {refund.status === 'APPROVED' && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Tandai selesai</h2>
          <p className="mb-3 text-xs text-gray-500">
            Aturan dua orang (CONTEXT.md, Refund; ticket 31): Admin yang menyelesaikan harus berbeda dari yang
            mengajukan maupun yang menyetujui, dan mentransfer dana secara manual ke rekening Donor sebelum mencatat
            bukti transfer di sini.
          </p>
          <AdminRefundCompleteForm
            refundId={refund.id}
            subject={{ type: subject.type, slug: subject.slug }}
            actorId={actorId}
            requestedById={refund.requestedById}
            approvedById={refund.approvedById}
          />
        </div>
      )}
    </div>
  );
}

