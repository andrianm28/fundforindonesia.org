import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';
import { dormantBalanceReport, type DormantBalanceRow } from '@/lib/money/dormant-balances';

/**
 * The 60-day Dormant Balance report (ticket 24; PRD §7.3, CONTEXT.md
 * "Dormant Balance"). Read-only: an Admin sees which Expired/Completed
 * Campaigns still hold a Campaign Balance 60 days or more after that, so
 * dormant money stops being something only a manual database look finds.
 * The PRD's own next step -- reallocating that balance to another Campaign
 * after 180 days and three reminders -- is explicitly out of Rilis 1
 * (`.scratch/rilis-1-benda/issues/24-dormant-60-day-report.md`), so this
 * page has no action column: it names Campaigns for an Admin to follow up
 * with a Payout by hand, the same stopgap CONTEXT.md already describes.
 */

const STATUS_LABEL: Record<DormantBalanceRow['status'], string> = {
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date),
  );
}

export default async function AdminDormantBalancesPage() {
  const rows = await dormantBalanceReport(prisma);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Laporan Dormant Balance</h1>
        <p className="text-gray-600 mt-1">
          Campaign Expired atau Completed yang Campaign Balance-nya belum dicairkan 60 hari atau lebih
          ({rows.length} campaign)
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campaign
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Sejak
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Hari mengendap
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campaign Balance
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    Tidak ada Campaign Balance yang mengendap 60 hari atau lebih.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.campaignId} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <Link
                        href={`/campaign/${row.slug}`}
                        className="text-sm font-medium text-blue-700 hover:underline"
                      >
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{STATUS_LABEL[row.status]}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{formatDate(row.since)}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{row.daysSince} hari</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{formatRupiah(row.balance)}</td>
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
