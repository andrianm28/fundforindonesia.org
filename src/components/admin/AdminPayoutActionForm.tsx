'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PAYMENT_PROVIDER_NAMES } from '@/lib/payments/provider-names';
import { validateProofReference, validateProofNote } from '@/lib/payout-proof';
import type { PayoutStatus } from '@/generated/prisma/client';

/**
 * The Admin side of the two-person rule: approving a DRAFT Payout, or
 * completing an APPROVED one with proof, whichever the Payout's own status
 * calls for. The server is the only holder of every rule this form asks
 * about -- both routes it posts to re-check the two-person rule, the Bank
 * Account's eligibility and (on approve) the provider balance gate under
 * the subject's row lock -- so nothing here decides a Payout's fate. What
 * this form adds is asking for the right fields before submitting, and
 * showing the server's own refusal, in its own words, when it says no.
 *
 * TWO SUBJECTS, ONE FORM. A Payout is for a Campaign or a Volunteer Trip,
 * never both (assertExactlyOnePayoutSubject, src/lib/money/payout-subject.ts),
 * and the two existing route trees are the only doors that call
 * approvePayout/completePayout (src/lib/money/payouts.ts) -- there is no
 * subject-agnostic API. `subject.type` picks which door this form knocks on;
 * the rest of the request body is identical either way.
 *
 * PROVIDER BALANCE IS THE GATE (ticket 02; FFI-07; ADR 0006). No provider
 * this platform talks to exposes a balance API, so the only figure the
 * system can check approval against is one a person read off the provider's
 * own dashboard and typed in. Both fields are required by the route
 * (ProviderBalanceNotRecordedError / ProviderBalanceAmountError /
 * ProviderBalanceInsufficientError), so the button stays disabled until both
 * are filled in -- not because this form re-derives the gate, but so an
 * Admin is not sent to the server to be told what an empty field already
 * says.
 *
 * PROOF IS A STRUCTURED NOTE (ticket 13). `completePayout` refuses a
 * reference or note that is blank, whitespace-only or over length, through
 * the same `validateProofReference`/`validateProofNote` functions
 * (@/lib/payout-proof) this form asks before enabling its own button -- one
 * shared validator, not a rule this form enforces and the server merely
 * trusts. The route sends both fields on their own; `completePayout` joins
 * them into the one string `Payout.proofImage` stores.
 *
 * NO BANK ACCOUNT NUMBER ANYWHERE ON THIS FORM (ticket 12). Sumopod, the
 * only provider active before a disbursement API exists, is withdrawn from
 * by hand in its own dashboard -- the platform never needs to read the
 * plaintext number to instruct a transfer, so this form never asks
 * `readBankAccountNumber` for it and shows only what was always plaintext
 * (bank code, account holder name). Showing the number here would be
 * reading it for a payout that never needed it read.
 *
 * TWO-PERSON RULE, SAID BEFORE THE SERVER HAS TO. `approvePayout` refuses
 * the requester and `completePayout` refuses the approver
 * (SelfApprovalError / TwoPersonRuleError) -- both already true no matter
 * what this form does. When the signed-in Admin is that person, the form is
 * replaced with a sentence naming the rule, the same choice
 * CampaignPayoutPanel makes for a status or balance the server would also
 * refuse (src/components/campaign/CampaignPayoutPanel.tsx): telling an
 * Admin why is better than a button that submits into a refusal it could
 * have named first.
 */

interface PayoutSubject {
  type: 'campaign' | 'trip';
  slug: string;
}

interface AdminPayoutActionFormProps {
  payoutId: string;
  status: PayoutStatus;
  subject: PayoutSubject;
  /** The signed-in Admin viewing this form. */
  actorId: string;
  requestedById: string;
  approvedById: string | null;
}

function actionUrl(subject: PayoutSubject, payoutId: string, action: 'approve' | 'complete'): string {
  const base = subject.type === 'campaign' ? '/api/campaigns' : '/api/volunteer-trips';
  return `${base}/${subject.slug}/payouts/${payoutId}/${action}`;
}

export function AdminPayoutActionForm({
  payoutId,
  status,
  subject,
  actorId,
  requestedById,
  approvedById,
}: AdminPayoutActionFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  // Approve fields
  const [provider, setProvider] = useState('');
  const [providerBalance, setProviderBalance] = useState('');

  // Complete fields
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  async function post(url: string, body: Record<string, unknown>, genericError: string) {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(url, {
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

  if (status === 'DRAFT') {
    if (actorId === requestedById) {
      return (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Anda yang mengajukan Payout ini, jadi tidak bisa menyetujuinya sendiri -- aturan dua orang yang sama
          membutuhkan Admin lain.
        </p>
      );
    }

    const balance = Number(providerBalance);
    const canApprove =
      provider !== '' && providerBalance.trim() !== '' && Number.isFinite(balance) && !submitting;

    return (
      <div className="space-y-3">
        <label className="block text-sm text-gray-700">
          Penyedia pembayaran
          <select
            aria-label="Penyedia pembayaran"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">Pilih penyedia</option>
            {PAYMENT_PROVIDER_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-gray-700">
          Saldo di dashboard penyedia (Rp)
          <input
            aria-label="Saldo di dashboard penyedia (Rp)"
            inputMode="numeric"
            value={providerBalance}
            onChange={(e) => setProviderBalance(e.target.value.replace(/\D/g, ''))}
            placeholder="Dibaca langsung dari dashboard penyedia sebelum menyetujui"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
        <p className="text-xs text-gray-500">
          Wajib diisi (FFI-07): tidak ada API saldo, jadi ini satu-satunya kontrol yang memastikan uangnya benar
          benar ada di penyedia sebelum disetujui.
        </p>

        <button
          type="button"
          disabled={!canApprove}
          onClick={() =>
            post(
              actionUrl(subject, payoutId, 'approve'),
              { provider, providerBalance: balance },
              'Gagal menyetujui pencairan.',
            )
          }
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Setujui pencairan
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
    if (actorId === approvedById) {
      return (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Anda yang menyetujui Payout ini, jadi tidak bisa menandainya selesai sendiri -- aturan dua orang yang sama
          membutuhkan Admin lain.
        </p>
      );
    }

    const referenceError = validateProofReference(reference);
    const noteError = validateProofNote(note);
    const canComplete = referenceError === null && noteError === null && !submitting;

    return (
      <div className="space-y-3">
        <label className="block text-sm text-gray-700">
          Referensi transaksi
          <input
            aria-label="Referensi transaksi"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="mis. nomor referensi transfer bank"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm text-gray-700">
          Catatan
          <textarea
            aria-label="Catatan"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Apa yang dicek, mis. jumlah dan rekening tujuan yang cocok"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </label>
        <p className="text-xs text-gray-500">
          Bukti transfer wajib (ticket 13): referensi transaksi dan catatan keduanya diisi, bukan satu karakter
          kosong.
        </p>

        <button
          type="button"
          disabled={!canComplete}
          onClick={() =>
            post(
              actionUrl(subject, payoutId, 'complete'),
              { proofReference: reference, proofNote: note },
              'Gagal menandai pencairan selesai.',
            )
          }
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Tandai selesai
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
