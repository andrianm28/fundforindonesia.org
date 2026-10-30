import { SandboxBadge } from '@/components/money/SandboxBadge';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';
import { loadRefundSubjects, refundSubjectKey, type RefundSubjectInfo } from '@/lib/refund-subject-lookup';
import type { Refund } from '@/generated/prisma/client';
import { lateSettlementWorklistPage } from '@/lib/money/campaign-refund-proposals';
import { isDonorInitiatedRefund } from '@/lib/money/donor-refunds';
import { AdminLateSettlementRefundButton } from '@/components/admin/AdminLateSettlementRefundButton';

export const dynamic = 'force-dynamic';

/**
 * The Admin queue of REQUESTED and APPROVED Refunds -- ticket 23's
 * REQUESTED→APPROVED plus ticket 31's APPROVED→COMPLETED with proof of
 * transfer, the narrowed Rilis 1 scope the wider RefundStatus machine still
 * stays out of (issue 23). This is that screen's list half;
 * /admin/refunds/[id] is the detail/approve/complete half, and
 * /admin/refunds/new is the create half -- the same three-page shape
 * /admin/payouts already uses for the same reason (ticket 21).
 *
 * Two groups, not one list with a status column, mirroring
 * /admin/payouts/page.tsx: REQUESTED and APPROVED are the only two states
 * an Admin has anything left to do about -- COMPLETED and everything else
 * is a decision already made, and belongs on a history, not a queue an
 * Admin still works.
 */

const QUEUE_STATUSES: Refund['status'][] = ['REQUESTED', 'APPROVED'];

type QueueRow = Pick<Refund, 'id' | 'amount' | 'reason' | 'status' | 'createdAt' | 'sandbox'> & {
  requestedById: string;
  requestedBy: { name: string | null };
  payment: {
    donation: { campaignId: string; donorId: string | null } | null;
    registration: { batch: { tripId: string } } | null;
  };
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date),
  );
}

function QueueTable({
  title,
  refunds,
  subjects,
}: {
  title: string;
  refunds: QueueRow[];
  subjects: Map<string, RefundSubjectInfo>;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>
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
                    Tidak ada Refund di antrean ini.
                  </td>
                </tr>
              ) : (
                refunds.map((refund) => {
                  const subject = subjects.get(refundSubjectKey(refund));
                  return (
                    <tr key={refund.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {subject?.title ?? 'Tidak diketahui'}
                        <SandboxBadge sandbox={refund.sandbox} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {refund.requestedBy.name}
                        {isDonorInitiatedRefund(refund) && (
                          <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">Donor</span>
                        )}
                      </td>
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
    </div>
  );
}

export default async function AdminRefundsPage() {
  const refunds = (await prisma.refund.findMany({
    where: { status: { in: QUEUE_STATUSES } },
    orderBy: { createdAt: 'asc' },
    include: {
      requestedBy: { select: { name: true } },
      payment: {
        select: {
          donation: { select: { campaignId: true, donorId: true } },
          registration: { select: { batch: { select: { tripId: true } } } },
        },
      },
    },
  })) as QueueRow[];

  const subjects = await loadRefundSubjects(prisma, refunds);
  const { rows: lateSettlements, truncated: lateTruncated } = await lateSettlementWorklistPage(prisma);
  const awaitingApproval = refunds.filter((r) => r.status === 'REQUESTED');
  const awaitingCompletion = refunds.filter((r) => r.status === 'APPROVED');

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Refund</h1>
          <p className="text-gray-600 mt-1">
            Siklus Refund: diajukan → disetujui → selesai. Satu Admin membuat, Admin lain yang menyetujui, dan
            Admin ketiga yang menyelesaikan dengan bukti transfer (tiga orang berbeda). Refund yang belum
            disetujui bisa ditolak, dan yang sudah disetujui tetapi tidak bisa dibayar bisa ditandai gagal -- keduanya
            dari halaman Tinjau; status menunggu data rekening Donor dan diproses belum tersedia.
          </p>
        </div>
        <Link
          href="/admin/refunds/new"
          className="whitespace-nowrap rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white"
        >
          Buat Refund
        </Link>
      </div>

      <QueueTable title="Menunggu persetujuan" refunds={awaitingApproval} subjects={subjects} />
      <QueueTable title="Menunggu penyelesaian dengan bukti" refunds={awaitingCompletion} subjects={subjects} />

      <div className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Dana masuk setelah Campaign ditutup</h2>
        <p className="mb-3 text-sm text-gray-600">
          Donation yang dibayar setelah Campaign-nya Ditangguhkan, Dibatalkan, Selesai, atau Kedaluwarsa dan belum
          punya Refund. Dana tetap tercatat sebagai Settlement; Admin memutuskan apakah dikembalikan. Waktu
          penutupan diambil dari catatan perubahan status Campaign (untuk Kedaluwarsa, tenggat bila lebih awal).
        </p>
        {lateTruncated && (
          <p role="status" className="mb-3 text-sm font-medium text-amber-700">
            Menampilkan {lateSettlements.length} terlama; selesaikan dulu untuk melihat sisanya.
          </p>
        )}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ditutup</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dana masuk</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Jumlah</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {lateSettlements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      Tidak ada dana yang masuk setelah Campaign ditutup.
                    </td>
                  </tr>
                ) : (
                  lateSettlements.map((row) => (
                    <tr key={row.paymentId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.campaign.title}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{row.campaign.status}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{formatDate(row.campaign.closedAt)}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{formatDate(row.settledAt)}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{formatRupiah(row.amount)}</td>
                      <td className="px-6 py-4">
                        <AdminLateSettlementRefundButton paymentId={row.paymentId} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
