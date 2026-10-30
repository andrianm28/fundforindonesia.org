import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { formatRupiah } from '@/lib/utils/currency';
import { AdminCampaignTransferDecisionForm } from '@/components/admin/AdminCampaignTransferDecisionForm';

export const dynamic = 'force-dynamic';

/**
 * The Admin screen for Campaign Transfers (ticket 77; CONTEXT.md, Campaign
 * Transfer; PRD §7.2): zakat, wakaf or hibah money moving from a Suspended
 * Campaign to another Campaign of the same Kind. One Admin asked
 * (POST /api/admin/campaign-transfers); a DIFFERENT Admin decides here.
 *
 * The screen only displays the rules; campaign-transfers.ts owns them (C14,
 * owner 2026-10-04: hibah has no category limit until the sharia review), and
 * the API's refusals are shown by the decision form. The /admin layout owns
 * the literal 404 for anyone who is not an Admin.
 */

const HISTORY_LIMIT = 20;

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Menunggu',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

const KIND_LABEL: Record<string, string> = {
  DONATION: 'Donasi',
  ZAKAT: 'Zakat',
  WAKAF: 'Wakaf',
  HIBAH: 'Hibah',
};

type TransferRow = {
  id: string;
  amount: number;
  reason: string;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  decisionReason: string | null;
  requestedById: string;
  requestedBy: { name: string | null };
  decidedBy: { name: string | null } | null;
  source: { title: string; kind: string };
  target: { title: string; kind: string };
};

const include = {
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
  source: { select: { title: true, kind: true } },
  target: { select: { title: true, kind: true } },
} as const;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date),
  );
}

const TH = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';

function Party({ title, kind }: { title: string; kind: string }) {
  return (
    <>
      <span className="font-medium text-gray-900">{title}</span>
      <span className="ml-2 text-xs text-gray-500">{KIND_LABEL[kind] ?? kind}</span>
    </>
  );
}

export default async function AdminCampaignTransfersPage() {
  const session = await getServerSession();
  const actorId = session?.user?.id as string;

  const pending = (await prisma.campaignTransfer.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include,
  })) as unknown as TransferRow[];

  const decided = (await prisma.campaignTransfer.findMany({
    where: { status: { in: ['APPROVED', 'REJECTED'] } },
    orderBy: { decidedAt: 'desc' },
    take: HISTORY_LIMIT,
    include,
  })) as unknown as TransferRow[];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Transfer antar Campaign</h1>
        <p className="text-gray-600 mt-1">
          Dana zakat, wakaf, atau hibah dari Campaign yang Ditangguhkan dipindahkan ke Campaign lain dengan jenis
          yang sama; jumlahnya selalu seluruh saldo yang bisa dicairkan di Campaign sumber. Satu Admin mengajukan,
          Admin lain yang memutuskan. Wakaf hanya ke kategori yang sama, hibah hanya ke hibah (belum ada batas
          kategori sampai ada review syariah), dan transfer lintas jenis ditolak sistem.
        </p>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Menunggu keputusan</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className={TH}>Sumber</th>
                  <th className={TH}>Tujuan</th>
                  <th className={TH}>Jumlah</th>
                  <th className={TH}>Alasan</th>
                  <th className={TH}>Diajukan oleh</th>
                  <th className={TH}>Diajukan</th>
                  <th className={TH}>Aksi</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pending.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      Tidak ada transfer yang menunggu keputusan.
                    </td>
                  </tr>
                ) : (
                  pending.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50 align-top">
                      <td className="px-6 py-4 text-sm">
                        <Party {...t.source} />
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <Party {...t.target} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{formatRupiah(t.amount)}</td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">{t.reason}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{t.requestedBy.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{formatDate(t.createdAt)}</td>
                      <td className="px-6 py-4 min-w-64">
                        <AdminCampaignTransferDecisionForm
                          transferId={t.id}
                          actorId={actorId}
                          requestedById={t.requestedById}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Sudah diputuskan</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className={TH}>Sumber</th>
                  <th className={TH}>Tujuan</th>
                  <th className={TH}>Jumlah</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Diputuskan oleh</th>
                  <th className={TH}>Alasan keputusan</th>
                  <th className={TH}>Diputuskan</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {decided.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      Belum ada transfer yang diputuskan.
                    </td>
                  </tr>
                ) : (
                  decided.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm">
                        <Party {...t.source} />
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <Party {...t.target} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{formatRupiah(t.amount)}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{STATUS_LABEL[t.status] ?? t.status}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{t.decidedBy?.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">{t.decisionReason}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{t.decidedAt ? formatDate(t.decidedAt) : ''}</td>
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
