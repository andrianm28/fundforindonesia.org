import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { CampaignStatus, CancellationRequestStatus } from '@/generated/prisma/client';

/**
 * The Admin queue ticket 25 asks for (map.md FFI-07b: "Layar Admin
 * menjatuhkan/mencabut Suspension" -- 0 hasil; the backend,
 * src/lib/campaign-lifecycle.ts, is built and tested). Three groups, not
 * one list: a Campaign with an open Flag is a Suspension candidate, a
 * SUSPENDED Campaign is a lift candidate, and a pending Cancellation
 * request is neither -- each is a different decision an Admin makes, so
 * each gets its own section. This is the list half; /admin/campaigns/
 * lifecycle/[slug] is the form half.
 */

type FlaggedRow = { id: string; slug: string; title: string };
type SuspendedRow = { id: string; slug: string; title: string };
type CancellationRow = {
  id: string;
  reason: string;
  campaign: { slug: string; title: string };
};

function QueueTable<Row extends { id: string }>({
  title,
  emptyMessage,
  rows,
  renderRow,
}: {
  title: string;
  emptyMessage: string;
  rows: readonly Row[];
  renderRow: (row: Row) => React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campaign
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-6 py-8 text-center text-gray-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                rows.map((row) => renderRow(row))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReviewLink({ slug }: { slug: string }) {
  return (
    <Link
      href={`/admin/campaigns/lifecycle/${slug}`}
      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
    >
      Tinjau
    </Link>
  );
}

export default async function AdminCampaignLifecycleQueuePage() {
  const [flagged, suspended, cancellationRequests] = await Promise.all([
    prisma.campaign.findMany({
      where: { flags: { some: { resolution: null } } },
      select: { id: true, slug: true, title: true },
      orderBy: { createdAt: 'asc' },
    }) as Promise<FlaggedRow[]>,
    prisma.campaign.findMany({
      where: { lifecycleStatus: CampaignStatus.SUSPENDED },
      select: { id: true, slug: true, title: true },
      orderBy: { createdAt: 'asc' },
    }) as Promise<SuspendedRow[]>,
    prisma.cancellationRequest.findMany({
      where: { status: CancellationRequestStatus.PENDING },
      select: { id: true, reason: true, campaign: { select: { slug: true, title: true } } },
      orderBy: { createdAt: 'asc' },
    }) as Promise<CancellationRow[]>,
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Suspension &amp; Cancellation</h1>
        <p className="text-gray-600 mt-1">
          Suspension bisa dijatuhkan Admin dengan atau tanpa Flag Verifier, selama alasannya tercatat (ADR 0015).
          Cancellation adalah penarikan diri Fundraiser dari Campaign Active-nya sendiri, diputuskan Admin lain.
        </p>
      </div>

      <QueueTable
        title="Menunggu keputusan Suspension (ada Flag terbuka)"
        emptyMessage="Tidak ada Campaign dengan Flag terbuka."
        rows={flagged}
        renderRow={(row: FlaggedRow) => (
          <tr key={row.id} className="hover:bg-gray-50">
            <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.title}</td>
            <td className="px-6 py-4">
              <ReviewLink slug={row.slug} />
            </td>
          </tr>
        )}
      />

      <QueueTable
        title="Suspended (bisa dicabut)"
        emptyMessage="Tidak ada Campaign Suspended."
        rows={suspended}
        renderRow={(row: SuspendedRow) => (
          <tr key={row.id} className="hover:bg-gray-50">
            <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.title}</td>
            <td className="px-6 py-4">
              <ReviewLink slug={row.slug} />
            </td>
          </tr>
        )}
      />

      <QueueTable
        title="Pengajuan Cancellation"
        emptyMessage="Tidak ada pengajuan Cancellation yang menunggu."
        rows={cancellationRequests}
        renderRow={(row: CancellationRow) => (
          <tr key={row.id} className="hover:bg-gray-50">
            <td className="px-6 py-4">
              <p className="text-sm font-medium text-gray-900">{row.campaign.title}</p>
              <p className="text-xs text-gray-500 truncate max-w-xs">{row.reason}</p>
            </td>
            <td className="px-6 py-4">
              <ReviewLink slug={row.campaign.slug} />
            </td>
          </tr>
        )}
      />
    </div>
  );
}
