'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Ajukan refund" on one row of the worklist "Dana masuk setelah Campaign
 * ditutup" (PRD 7.2; ticket rilis-1-benda/80). Posts the Payment to
 * POST /api/admin/refunds/late-settlements and refreshes the page on success,
 * so the row leaves the list and the Refund appears in the queue above. The
 * server re-derives the row and answers any refusal in its own words.
 */
export function AdminLateSettlementRefundButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch('/api/admin/refunds/late-settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRefusal(data?.error ?? 'Gagal mengajukan refund.');
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal mengajukan refund.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
      >
        {submitting ? 'Memproses...' : 'Ajukan refund'}
      </button>
      {refusal && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {refusal}
        </p>
      )}
    </div>
  );
}
