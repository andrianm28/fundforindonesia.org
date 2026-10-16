'use client';

import { useState } from 'react';
import { formatRupiah } from '@/lib/utils/currency';

/**
 * "Usulkan Refund untuk semua Donor" on a Suspended or Cancelled Campaign's
 * Admin page (PRD 7.2; ticket audit-2026-10-16/07). One click posts to
 * POST /api/admin/campaigns/[slug]/refund-proposals and shows what the server
 * did: created, already standing, and the skipped Payments by reason, with the
 * money that already left shown as its own line. The server holds every rule;
 * this component only asks for confirmation and reports.
 */

type SkipReason = 'sudahKeluar' | 'kindTerbatas' | 'modeBerbeda' | 'anonim' | 'dipindahkan';

interface ProposalResult {
  created: Array<{ refundId: string; paymentId: string; amount: number }>;
  alreadyProposed: number;
  skipped: Array<{ paymentId: string; amount: number; reason: SkipReason }>;
  paidOut: { count: number; amount: number };
}

const SKIP_LABEL: Record<SkipReason, string> = {
  sudahKeluar: 'dana sudah keluar',
  kindTerbatas: 'Kind terbatas, tidak ada alasan yang cocok',
  modeBerbeda: 'dana uji coba / mode berbeda',
  anonim: 'Donation sudah dianonimkan',
  dipindahkan: 'dana sudah dipindahkan ke Campaign lain',
};

export function AdminCampaignRefundProposals({ campaignSlug }: { campaignSlug: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<ProposalResult | null>(null);

  async function submit() {
    if (!window.confirm('Usulkan Refund untuk semua Payment Campaign ini yang dananya belum keluar?')) return;
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignSlug}/refund-proposals`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRefusal(data?.error ?? 'Gagal mengusulkan refund.');
        return;
      }
      setResult(data as ProposalResult);
    } catch {
      setRefusal('Gagal mengusulkan refund.');
    } finally {
      setSubmitting(false);
    }
  }

  const otherSkips = result?.skipped.filter((s) => s.reason !== 'sudahKeluar') ?? [];

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <h2 className="text-sm font-semibold text-gray-900">Refund untuk semua Donor</h2>
      <p className="mt-1 text-sm text-gray-600">
        Membuat Refund berstatus Diajukan untuk setiap Payment yang dananya belum keluar. Anda menjadi pengaju;
        dua Admin berbeda dari Anda menyetujui dan menyelesaikannya. Aman diulang: Payment yang sudah punya Refund
        tidak diusulkan lagi.
      </p>
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? 'Memproses...' : 'Usulkan Refund untuk semua Donor'}
      </button>
      {refusal && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {refusal}
        </p>
      )}
      {result && (
        <div role="status" className="mt-3 space-y-1 text-sm text-gray-800">
          <p>
            {result.created.length} Refund diusulkan
            {result.created.length > 0 && ` (total ${formatRupiah(result.created.reduce((s, c) => s + c.amount, 0))})`}.
          </p>
          <p>{result.alreadyProposed} Payment sudah punya Refund.</p>
          {result.paidOut.count > 0 && (
            <p>
              {result.paidOut.count} Payment dilewati karena dananya sudah keluar lewat Payout,
              senilai {formatRupiah(result.paidOut.amount)}. Penagihan ke Fundraiser berjalan di luar sistem.
            </p>
          )}
          {otherSkips.length > 0 && (
            <ul className="list-disc pl-5">
              {otherSkips.map((s) => (
                <li key={s.paymentId}>
                  {formatRupiah(s.amount)}: {SKIP_LABEL[s.reason]}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
