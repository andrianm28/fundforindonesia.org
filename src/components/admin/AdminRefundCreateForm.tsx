'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * An Admin creates a Refund for a Donation's paid Payment, already resolved
 * by /admin/refunds/new (src/app/admin/refunds/new/page.tsx) -- this form
 * only asks for amount and reason and posts them to the existing
 * POST /api/campaigns/[slug]/refunds route (src/app/api/campaigns/[slug]/refunds/route.ts)
 * unchanged. The server is the only holder of every rule this form asks
 * about -- the per-Kind eligibility gate (requireRefundAllowedForKind,
 * ticket 06/ADR 0013) and the cumulative remaining-amount cap
 * (RefundExceedsRemainingError) -- so this form shows the server's own
 * refusal, in its own words, rather than re-deriving either.
 */

interface AdminRefundCreateFormProps {
  campaignSlug: string;
  paymentId: string;
}

export function AdminRefundCreateForm({ campaignSlug, paymentId }: AdminRefundCreateFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const parsedAmount = Number(amount);
  const canSubmit =
    amount.trim() !== '' && Number.isInteger(parsedAmount) && parsedAmount > 0 && reason.trim() !== '' && !submitting;

  async function submit() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignSlug}/refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, amount: parsedAmount, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal membuat refund.');
        return;
      }
      router.push(`/admin/refunds/${body.id}`);
    } catch {
      setRefusal('Gagal membuat refund.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-700">
        Jumlah Refund (Rp)
        <input
          aria-label="Jumlah Refund (Rp)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="block text-sm text-gray-700">
        Alasan
        <textarea
          aria-label="Alasan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="mis. salah bayar, bayar ganda, dana masuk setelah Campaign ditutup"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Buat Refund
      </button>

      {refusal && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
