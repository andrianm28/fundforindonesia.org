'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateProofReference, validateProofNote } from '@/lib/payout-proof';

/**
 * The Admin side of a Refund's two-person rule, third act (ticket 31;
 * CONTEXT.md, Refund: "dibuat satu Admin, disetujui Admin lain, dan
 * diselesaikan Admin yang berbeda dari penyetujunya"). A third Admin --
 * neither the one who requested this Refund nor the one who approved it --
 * has transferred the money by hand to the Donor's account and comes back
 * here with proof and the destination they used.
 *
 * The server is the only holder of every rule this form asks about: both
 * complete routes re-check the two-person rule (against both the requester
 * AND the approver, unlike a Payout's single check) and the proof shape
 * under the subject's row lock. This form only asks for the right fields
 * before submitting and shows the server's own refusal, in its own words,
 * when it says no -- the same discipline AdminPayoutActionForm and
 * AdminRefundApproveForm already follow.
 *
 * TWO SUBJECTS, ONE FORM, same as AdminRefundApproveForm: `subject.type`
 * picks which of the two route trees this form posts to.
 *
 * PROOF IS A STRUCTURED NOTE (ticket 13), asked through the exact same
 * `validateProofReference`/`validateProofNote` functions (@/lib/payout-proof)
 * completePayout's form already asks -- one shared validator, three callers.
 *
 * THE DONOR ACCOUNT NUMBER IS TYPED HERE, NOT READ FROM A SAVED ROW
 * (CONTEXT.md, Bank Account: there is no saved BankAccount for a Donor).
 * The server seals it (ADR 0012) and this form never asks for it back --
 * once submitted, the number is gone from this screen's own state.
 */

interface RefundSubject {
  type: 'campaign' | 'trip';
  slug: string;
}

interface AdminRefundCompleteFormProps {
  refundId: string;
  subject: RefundSubject;
  /** The signed-in Admin viewing this form. */
  actorId: string;
  requestedById: string;
  approvedById: string | null;
}

function completeUrl(subject: RefundSubject, refundId: string): string {
  const base = subject.type === 'campaign' ? '/api/campaigns' : '/api/volunteer-trips';
  return `${base}/${subject.slug}/refunds/${refundId}/complete`;
}

export function AdminRefundCompleteForm({ refundId, subject, actorId, requestedById, approvedById }: AdminRefundCompleteFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  if (actorId === requestedById) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Anda yang mengajukan Refund ini, jadi tidak bisa menandainya selesai sendiri -- aturan dua orang membutuhkan
        Admin yang berbeda dari pengaju maupun penyetuju.
      </p>
    );
  }
  if (actorId === approvedById) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Anda yang menyetujui Refund ini, jadi tidak bisa menandainya selesai sendiri -- aturan dua orang membutuhkan
        Admin yang berbeda dari pengaju maupun penyetuju.
      </p>
    );
  }

  const referenceError = validateProofReference(reference);
  const noteError = validateProofNote(note);
  const canComplete =
    referenceError === null &&
    noteError === null &&
    bankCode.trim() !== '' &&
    accountName.trim() !== '' &&
    accountNumber.trim() !== '' &&
    !submitting;

  async function complete() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(completeUrl(subject, refundId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proofReference: reference,
          proofNote: note,
          donorBankCode: bankCode,
          donorAccountName: accountName,
          donorAccountNumber: accountNumber,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menandai refund selesai.');
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal menandai refund selesai.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Rekening tujuan Donor (dicatat manual saat ini, ticket 31): tidak ada Bank Account tersimpan untuk Donor,
        jadi Admin mengisinya di sini setelah mentransfer secara manual.
      </p>

      <label className="block text-sm text-gray-700">
        Kode bank
        <input
          aria-label="Kode bank"
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
          placeholder="mis. BCA"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="block text-sm text-gray-700">
        Nama pemilik rekening
        <input
          aria-label="Nama pemilik rekening"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="Sesuai nama pada Donation"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="block text-sm text-gray-700">
        Nomor rekening
        <input
          aria-label="Nomor rekening"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          placeholder="Nomor rekening tujuan Donor"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

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
        Bukti transfer wajib (ticket 13): referensi transaksi dan catatan keduanya diisi, bukan satu karakter kosong.
      </p>

      <button
        type="button"
        disabled={!canComplete}
        onClick={complete}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Tandai Refund selesai
      </button>

      {refusal && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
