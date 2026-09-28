import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';
import type { ManualContribution } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';

/**
 * The Admin queue for a Manual Contribution's PENDING half (ticket 26;
 * CONTEXT.md, Manual Contribution; PRD FFI-07c): money that arrived outside
 * the payment gateway, recorded by one Admin, waiting for a different one to
 * decide. This is that screen's list half; /admin/manual-contributions/[id]
 * is the detail/decision half, and /admin/manual-contributions/new is the
 * record half -- the same three-page shape /admin/payouts and
 * /admin/refunds already use for the same reason.
 *
 * ONE QUEUE, NOT TWO. Unlike Payout and Refund, there is nothing an Admin
 * still has to DO once a Manual Contribution is APPROVED -- the money is
 * already in the books. A reversal exists (a third Admin, CONTEXT.md), but
 * it is not a queue item waiting on anyone; an APPROVED row is a decision
 * already made, and is read from its own detail page rather than surfaced
 * here as something pending.
 *
 * CAMPAIGN AND PROGRAM, THROUGH REAL RELATIONS. Unlike Payout/Refund,
 * ManualContribution.campaignId/programId carry actual Prisma relations
 * (schema.prisma), so the subject's title is read with one .include()
 * rather than the batched-lookup shape those two screens need.
 */

type QueueRow = Pick<ManualContribution, 'id' | 'amount' | 'proofReference' | 'status' | 'createdAt'> & {
  recordedBy: { name: string | null };
  campaign: { title: string } | null;
  program: { title: string } | null;
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date),
  );
}

export default async function AdminManualContributionsPage() {
  const contributions = (await prisma.manualContribution.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: {
      recordedBy: { select: { name: true } },
      campaign: { select: { title: true } },
      program: { select: { title: true } },
    },
  })) as QueueRow[];

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manual Contribution</h1>
          <p className="text-gray-600 mt-1">
            Uang yang masuk di luar payment gateway -- transfer bank, tunai di acara. Satu Admin mencatat dengan
            bukti, Admin lain yang menyetujui sebelum uangnya masuk ke pembukuan (CONTEXT.md, Manual Contribution).
          </p>
        </div>
        <Link
          href="/admin/manual-contributions/new"
          className="whitespace-nowrap rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white"
        >
          Catat Manual Contribution
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subjek</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dicatat oleh</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Jumlah</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bukti</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dicatat</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {contributions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    Tidak ada Manual Contribution yang menunggu persetujuan.
                  </td>
                </tr>
              ) : (
                contributions.map((contribution) => (
                  <tr key={contribution.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {contribution.campaign?.title ?? contribution.program?.title ?? 'Tidak diketahui'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{contribution.recordedBy.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{formatRupiah(contribution.amount)}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-xs">{contribution.proofReference}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{formatDate(contribution.createdAt)}</td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/manual-contributions/${contribution.id}`}
                        className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        Tinjau
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
