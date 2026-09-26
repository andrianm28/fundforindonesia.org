import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { effectiveStatus } from "@/lib/campaign-lifecycle";
import { CampaignStatusBadge } from "@/components/campaign/CampaignStatusBadge";

export default async function AdminCampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
    take: 50,
    orderBy: { createdAt: "desc" },
    include: {
      creator: {
        select: { name: true, email: true },
      },
    },
  });
  const now = new Date();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Manajemen Kampanye</h1>
        <p className="text-gray-600 mt-1">
          Kelola semua kampanye di platform ({campaigns.length} kampanye)
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Judul
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Pembuat
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Target
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Terkumpul
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tanggal Dibuat
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {campaigns.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-12 text-center text-gray-500"
                  >
                    Belum ada kampanye di platform
                  </td>
                </tr>
              ) : (
                campaigns.map((campaign) => (
                  <tr key={campaign.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="max-w-xs">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {campaign.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          /{campaign.slug}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm text-gray-900">
                          {campaign.creator.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {campaign.creator.email}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <CampaignStatusBadge status={effectiveStatus(campaign, now)} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {formatCurrency(campaign.targetAmount)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {formatCurrency(campaign.collectedAmount)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(campaign.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/campaign/${campaign.slug}`}
                          className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          Lihat
                        </Link>
                        <Link
                          href={`/campaign/${campaign.slug}/edit`}
                          className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-yellow-50 text-yellow-700 hover:bg-yellow-100 transition-colors"
                        >
                          Edit
                        </Link>
                      </div>
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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}
