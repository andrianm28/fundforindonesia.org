'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ManualContributionStatus } from '@/generated/prisma/client';

/**
 * The Admin side of a Manual Contribution's two-person rule (ticket 26;
 * CONTEXT.md, Manual Contribution): a DIFFERENT Admin approves or rejects a
 * PENDING record, and a THIRD Admin -- neither the recorder nor the
 * decider -- reverses an APPROVED one. The server is the only holder of the
 * rule (SelfApprovalError, thrown before any write, from both the recorder
 * and the decider for a reversal) -- this form only asks for confirmation
 * and a reason where the route requires one, and shows the server's own
 * refusal, in its own words, when it says no.
 *
 * POSTS TO ONE URL, ONE BODY SHAPE. Unlike Payout/Refund, a Manual
 * Contribution decision has no Campaign/Trip slug in its path -- the route
 * is id-only (POST /api/admin/manual-contributions/[id]/decision) because
 * approveManualContribution/rejectManualContribution/reverseManualContribution
 * take the target off the stored row, not off the request
 * (src/app/api/admin/manual-contributions/[id]/decision/route.ts).
 */

interface AdminManualContributionDecisionFormProps {
  manualContributionId: string;
  status: ManualContributionStatus;
  /** The signed-in Admin viewing this form. */
  actorId: string;
  recordedById: string;
  decidedById: string | null;
}

export function AdminManualContributionDecisionForm({
  manualContributionId,
  status,
  actorId,
  recordedById,
  decidedById,
}: AdminManualContributionDecisionFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function post(body: Record<string, unknown>, genericError: string) {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/admin/manual-contributions/${manualContributionId}/decision`, {
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

  if (status === 'PENDING') {
    if (actorId === recordedById) {
      return (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Anda yang mencatat Manual Contribution ini, jadi tidak bisa menyetujuinya sendiri -- aturan dua orang yang
          sama membutuhkan Admin lain.
        </p>
      );
    }

    const canReject = reason.trim() !== '' && !submitting;

    return (
      <div className="space-y-3">
        <button
          type="button"
          disabled={submitting}
          onClick={() => post({ decision: 'approve' }, 'Gagal menyetujui Manual Contribution.')}
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
            placeholder="mis. bukti tidak jelas, jumlah tidak cocok"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        <button
          type="button"
          disabled={!canReject}
          onClick={() => post({ decision: 'reject', reason }, 'Gagal menolak Manual Contribution.')}
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

  if (status === 'APPROVED') {
    if (actorId === recordedById || actorId === decidedById) {
      return (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Anda mencatat atau menyetujui Manual Contribution ini, jadi tidak bisa membalikkannya sendiri -- aturan
          dua orang membutuhkan Admin ketiga.
        </p>
      );
    }

    const canReverse = reason.trim() !== '' && !submitting;

    return (
      <div className="space-y-3">
        <label className="block text-sm text-gray-700">
          Alasan
          <textarea
            aria-label="Alasan"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="mis. salah catat, ternyata dana tidak pernah diterima"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        <button
          type="button"
          disabled={!canReverse}
          onClick={() => post({ decision: 'reverse', reason }, 'Gagal membalikkan Manual Contribution.')}
          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 disabled:opacity-50"
        >
          Balikkan
        </button>

        {refusal && (
          <p role="alert" className="text-sm text-danger">
            {refusal}
          </p>
        )}
      </div>
    );
  }

  return null;
}
