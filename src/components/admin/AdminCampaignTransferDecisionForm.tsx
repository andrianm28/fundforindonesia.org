'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The second Admin's half of a Campaign Transfer (ticket 77; CONTEXT.md,
 * Campaign Transfer). The server is the only holder of the rules -- the
 * two-person rule, the Kind rules (hibah only to hibah, no cross-Kind), the
 * Suspension and balance checks (campaign-transfers.ts) -- so this form only
 * collects the decision and shows the server's refusal in its own words. The
 * requester notice is a courtesy; the backend refuses a self-decision anyway.
 *
 * POST /api/admin/campaign-transfers/[id]/decision, { decision: 'approve' } or
 * { decision: 'reject', reason }.
 */

interface AdminCampaignTransferDecisionFormProps {
  transferId: string;
  /** The signed-in Admin viewing this form. */
  actorId: string;
  requestedById: string;
}

export function AdminCampaignTransferDecisionForm({
  transferId,
  actorId,
  requestedById,
}: AdminCampaignTransferDecisionFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function post(body: Record<string, unknown>, genericError: string) {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/admin/campaign-transfers/${transferId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const responseBody = await res.json().catch(() => ({}));
        setRefusal(
          typeof responseBody.error === 'string' && responseBody.error !== '' ? responseBody.error : genericError,
        );
        return;
      }
      router.refresh();
    } catch {
      setRefusal(genericError);
    } finally {
      setSubmitting(false);
    }
  }

  if (actorId === requestedById) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Anda yang mengajukan transfer ini, jadi tidak bisa memutuskannya sendiri -- aturan dua orang membutuhkan
        Admin lain.
      </p>
    );
  }

  const canReject = reason.trim() !== '' && !submitting;

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={submitting}
        onClick={() => post({ decision: 'approve' }, 'Gagal menyetujui transfer.')}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Setujui
      </button>

      <label className="block text-sm text-gray-700">
        Alasan (wajib untuk menolak)
        <textarea
          aria-label="Alasan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="mis. Campaign tujuan tidak sesuai"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <button
        type="button"
        disabled={!canReject}
        onClick={() => post({ decision: 'reject', reason }, 'Gagal menolak transfer.')}
        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-50"
      >
        Tolak
      </button>

      {refusal && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
