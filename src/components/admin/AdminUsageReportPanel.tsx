'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRupiah } from '@/lib/utils/currency';

/**
 * A COMPLETED Campaign Payout's Usage Report, for the Admin looking at that
 * Payout (ticket 22; PRD FFI-07a; CONTEXT.md, Usage Report): the report
 * itself if the Fundraiser sent one, and a way to mark it "dipertanyakan"
 * with a reason -- both public on the Campaign page the instant they are
 * written, and the server (@/lib/usage-reports.ts, disputeUsageReport) is the
 * only holder of the rule that a dispute cannot be lifted or repeated; this
 * form only asks for the reason and shows the server's own refusal.
 *
 * NEVER SHOWN FOR A TRIP PAYOUT. Usage Report is scoped to Campaign
 * (CONTEXT.md ties it to "halaman Campaign" by name); the caller
 * (admin/payouts/[id]/page.tsx) renders this only for `subject.type ===
 * 'campaign'`.
 */

/**
 * Only http(s) is a photo anyone can host as public evidence -- a
 * `javascript:` URL is a link that would run when clicked, and `data:` is not
 * evidence of anything hosted at all. The service layer
 * (@/lib/usage-reports.ts) already refuses either at submission time; this is
 * a second, independent check at render time.
 */
function isPublicPhotoUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

interface UsageReportSummary {
  id: string;
  narrative: string;
  lineItems: Array<{ label: string; amount: number }>;
  beneficiaryCount: number;
  photos: string[];
  disputedAt: string | null;
  disputedReason: string | null;
}

export function AdminUsageReportPanel({
  slug,
  payoutId,
  usageReport,
}: {
  slug: string;
  payoutId: string;
  usageReport: UsageReportSummary | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!usageReport) {
    return (
      <p className="mt-2 text-sm text-gray-500">Fundraiser belum mengirim Usage Report untuk Payout ini.</p>
    );
  }

  async function dispute() {
    if (reason.trim() === '' || submitting) return;
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/campaigns/${slug}/payouts/${payoutId}/usage-report`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(
          typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menandai dipertanyakan.',
        );
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal menandai dipertanyakan.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm text-gray-900">{usageReport.narrative}</p>
      <ul className="space-y-0.5">
        {usageReport.lineItems.map((item, idx) => (
          <li key={idx} className="flex justify-between text-xs text-gray-600">
            <span>{item.label}</span>
            <span className="font-medium text-gray-900">{formatRupiah(item.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-600">{usageReport.beneficiaryCount} penerima manfaat</p>

      {usageReport.photos.filter(isPublicPhotoUrl).length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {usageReport.photos.filter(isPublicPhotoUrl).map((photo, idx) => (
            <li key={photo}>
              <a
                href={photo}
                target="_blank"
                rel="noopener noreferrer"
                className="block h-16 w-16 overflow-hidden rounded-lg border border-gray-300"
              >
                {/* Fundraiser-supplied URL, so a plain <img>, not next/image. */}
                <img src={photo} alt={`Foto bukti ${idx + 1}`} className="h-full w-full object-cover" />
              </a>
            </li>
          ))}
        </ul>
      )}

      {usageReport.disputedAt ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Dipertanyakan: {usageReport.disputedReason}
        </p>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm text-gray-700">
            Alasan dipertanyakan
            <textarea
              aria-label="Alasan dipertanyakan"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={dispute}
            disabled={reason.trim() === '' || submitting}
            className="rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger disabled:opacity-50"
          >
            Tandai dipertanyakan
          </button>
          {refusal && (
            <p role="alert" className="text-sm text-danger">
              {refusal}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
