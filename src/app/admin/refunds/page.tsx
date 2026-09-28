import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';
import { loadRefundSubjects, refundSubjectKey, type RefundSubjectInfo } from '@/lib/refund-subject-lookup';
import type { Refund } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';

/**
 * The Admin queue of REQUESTED Refunds -- ticket 23's narrowed Rilis 1
 * scope: only create (Admin) and approve (a DIFFERENT Admin) get a screen,
 * the wider RefundStatus machine stays in the schema untouched (issue 23).
 * This is that screen's list half; /admin/refunds/[id] is the detail/approve
 * half, and /admin/refunds/new is the create half -- the same three-page
 * shape /admin/payouts already uses for the same reason (ticket 21).
 *
 * Only REQUESTED, not a status column with every value: APPROVED is a
 * decision already made and belongs on a history, not a queue an Admin
 * still has something to do about.
 */

type QueueRow = Pick<Refund, 'id' | 'amount' | 'reason' | 'status' | 'createdAt'> & {
  requestedBy: { name: string | null };
  payment: {
    donation: { campaignId: string } | null;
    registration: { batch: { tripId: string } } | null;
  };
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date),
  );
}

function QueueTable({ refunds, subjects }: { refunds: QueueRow[]; subjects: Map<string, RefundSubjectInfo> }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subjek</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Diajukan oleh</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Jumlah</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Alasan</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Diajukan</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {refunds.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  Tidak ada Refund yang menunggu persetujuan.
                </td>
              </tr>
            ) : (
              refunds.map((refund) => {
                const subject = subjects.get(refundSubjectKey(refund));
                return (
                  <tr key={refund.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{subject?.title ?? 'Tidak diketahui'}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{refund.requestedBy.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{formatRupiah(refund.amount)}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-xs">{refund.reason}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{formatDate(refund.createdAt)}</td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/refunds/${refund.id}`}
                        className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        Tinjau
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function AdminRefundsPage() {
  const refunds = (await prisma.refund.findMany({
    where: { status: 'REQUESTED' },
    orderBy: { createdAt: 'asc' },
    include: {
      requestedBy: { select: { name: true } },
      payment: {
        select: {
          donation: { select: { campaignId: true } },
          registration: { select: { batch: { select: { tripId: true } } } },
        },
      },
    },
  })) as QueueRow[];

  const subjects = await loadRefundSubjects(prisma, refunds);

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Refund</h1>
          <p className="text-gray-600 mt-1">
            Rilis 1: hanya siklus REQUESTED → APPROVED. Satu Admin membuat, Admin lain yang menyetujui (dua orang
            berbeda) -- status lain (AwaitingDonorDetails, Processing, Completed, Rejected, Failed) menyusul di
            rilis berikutnya.
          </p>
        </div>
        <Link
          href="/admin/refunds/new"
          className="whitespace-nowrap rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white"
        >
          Buat Refund
        </Link>
      </div>

      <h2 className="mb-3 text-lg font-semibold text-gray-900">Menunggu persetujuan</h2>
      <QueueTable refunds={refunds} subjects={subjects} />
    </div>
  );
}
