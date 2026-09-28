import { prisma } from '@/lib/prisma';
import { resolveAbuseThresholds } from '@/lib/abuse-thresholds';
import { AdminAbuseThresholdForm } from '@/components/admin/AdminAbuseThresholdForm';
import type { AbuseThresholdKind } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';

/**
 * Ticket 27 (map.md: `/api/admin/abuse-thresholds` had no page behind it):
 * reads and edits the four limits the platform watches itself against
 * (PRD §"Anti penyalahgunaan"; CONTEXT.md, Verifikasi Tambahan / Penanda
 * Audit / Penanda Donasi; src/lib/abuse-thresholds.ts). Read here the same
 * way /admin/scrutiny reads them -- resolveAbuseThresholds against the same
 * prisma client, so the number shown is the number in force, an Admin's
 * latest row for a kind or the PRD's own default for a kind nobody has set.
 * Each row posts to the existing POST /api/admin/abuse-thresholds route
 * unchanged (AdminAbuseThresholdForm); this page adds no route and no new
 * threshold.
 *
 * PETUNJUK DUPLIKAT STAYS OUT (ticket 04's answer, batch grilling round
 * 2026-09-28): the title similarity Admins set for duplicate hints is a
 * different table with its own route (POST /api/admin/duplicate-similarity)
 * and, like the Escrow Hold length, stays a code constant deferred to Fase
 * 3 -- not shown, not editable, here.
 */

const ROWS: { kind: AbuseThresholdKind; label: string; unit: 'rupiah' | 'count'; description: string }[] = [
  {
    kind: 'CAMPAIGN_REVIEW_GROSS',
    label: 'Verifikasi Tambahan',
    unit: 'rupiah',
    description: 'Akumulasi Gross Campaign di atas ini membuka pemeriksaan ulang oleh Verifier.',
  },
  {
    kind: 'CAMPAIGN_AUDIT_GROSS',
    label: 'Penanda Audit',
    unit: 'rupiah',
    description: 'Akumulasi Gross Campaign di atas ini memasang Penanda Audit, sekali seumur Campaign.',
  },
  {
    kind: 'DONATION_REVIEW_AMOUNT',
    label: 'Penanda Donasi',
    unit: 'rupiah',
    description: 'Satu Donation di atas ini dicatat untuk diperiksa Admin; tidak pernah menahan apa pun.',
  },
  {
    kind: 'ACTIVE_CAMPAIGNS_PER_FUNDRAISER',
    label: 'Batas Campaign Active',
    unit: 'count',
    description: 'Jumlah Campaign Active seorang Fundraiser boleh jalankan sebelum Usage Report pertamanya.',
  },
];

export default async function AdminAbuseThresholdsPage() {
  const thresholds = await resolveAbuseThresholds(prisma);

  const currentValueByKind: Record<AbuseThresholdKind, number> = {
    CAMPAIGN_REVIEW_GROSS: thresholds.campaignReviewGross,
    CAMPAIGN_AUDIT_GROSS: thresholds.campaignAuditGross,
    DONATION_REVIEW_AMOUNT: thresholds.donationReviewAmount,
    ACTIVE_CAMPAIGNS_PER_FUNDRAISER: thresholds.activeCampaignsPerFundraiser,
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ambang Penyalahgunaan</h1>
        <p className="mt-1 text-sm text-gray-500">
          Empat batas yang diawasi platform sendiri (PRD §&quot;Anti penyalahgunaan&quot;). Setiap perubahan tersimpan
          sebagai baris baru -- nilai lama tetap terbaca untuk Donation atau Campaign yang sudah dinilai dengannya.
        </p>
      </div>

      <div className="space-y-4">
        {ROWS.map((row) => (
          <div key={row.kind} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="mb-3 text-xs text-gray-500">{row.description}</p>
            <AdminAbuseThresholdForm
              kind={row.kind}
              label={row.label}
              unit={row.unit}
              currentValue={currentValueByKind[row.kind]}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
