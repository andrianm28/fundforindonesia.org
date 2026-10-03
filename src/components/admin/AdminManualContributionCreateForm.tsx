'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * An Admin records a Manual Contribution -- money that arrived outside the
 * payment gateway (ticket 26; CONTEXT.md, Manual Contribution; PRD FFI-07c).
 * The target Campaign or Program is already resolved by
 * /admin/manual-contributions/new (src/app/admin/manual-contributions/new/page.tsx);
 * this form only asks for amount, proof and an optional note, and posts
 * exactly the body recordManualContribution expects
 * (src/lib/money/manual-contributions.ts) to
 * POST /api/admin/manual-contributions.
 *
 * NOTHING HERE DECIDES ANYTHING. Recording posts nothing to the ledger --
 * a second, different Admin approves on the resulting detail page
 * (AdminManualContributionDecisionForm) before the money is real. Every rule
 * this form's fields hint at (amount must be a positive Rupiah integer,
 * proof is required, a Demo Campaign or the Campaign's own Fundraiser is
 * refused) is enforced server-side; this form shows the server's own
 * refusal, in its own words, rather than re-deriving any of it.
 */

type ManualContributionTarget =
  | { type: 'campaign'; id: string }
  | { type: 'program'; id: string };

interface AdminManualContributionCreateFormProps {
  target: ManualContributionTarget;
}

export function AdminManualContributionCreateForm({ target }: AdminManualContributionCreateFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [proofReference, setProofReference] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const parsedAmount = Number(amount);
  const canSubmit =
    amount.trim() !== '' &&
    Number.isInteger(parsedAmount) &&
    parsedAmount > 0 &&
    proofReference.trim() !== '' &&
    !submitting;

  async function submit() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch('/api/admin/manual-contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(target.type === 'campaign' ? { campaignId: target.id } : { programId: target.id }),
          amount: parsedAmount,
          proofReference,
          note: note.trim() === '' ? undefined : note,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefusal(
          typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal mencatat Manual Contribution.',
        );
        return;
      }
      router.push(`/admin/manual-contributions/${body.contribution.id}`);
    } catch {
      setRefusal('Gagal mencatat Manual Contribution.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-700">
        Jumlah (Rp)
        <input
          aria-label="Jumlah (Rp)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="block text-sm text-gray-700">
        Bukti transfer
        <input
          aria-label="Bukti transfer"
          value={proofReference}
          onChange={(e) => setProofReference(e.target.value)}
          placeholder="mis. nomor referensi transfer bank, tautan bukti"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>
      <p className="text-xs text-gray-500">
        Wajib diisi -- tidak ada penyedia yang mengonfirmasi uang ini, jadi bukti ini satu-satunya yang berdiri di
        belakang angkanya.
      </p>

      <label className="block text-sm text-gray-700">
        Catatan (opsional)
        <textarea
          aria-label="Catatan"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="mis. siapa yang menyerahkan, bank apa, untuk apa"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Catat kontribusi
      </button>

      {refusal && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
