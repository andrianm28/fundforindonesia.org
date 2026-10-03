'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { OwnSubjectNotice } from './OwnSubjectNotice';

/**
 * The Admin side of a Refund's two-person rule (ticket 23; CONTEXT.md,
 * Refund): a DIFFERENT Admin than the one who created it approves a
 * REQUESTED Refund. The server is the only holder of the rule -- both
 * approve routes already refuse the requester (SelfApprovalError) -- so
 * this form only asks for confirmation and shows the server's own refusal,
 * in its own words, when it says no. Structural sibling of
 * AdminPayoutActionForm (src/components/admin/AdminPayoutActionForm.tsx),
 * narrowed to one action because Rilis 1 only builds REQUESTED -> APPROVED.
 *
 * TWO SUBJECTS, ONE FORM. A Refund's Payment names a Campaign or a
 * Volunteer Trip, never both (assertExactlyOnePaymentSubject), and the two
 * existing route trees are the only doors that call approveRefund
 * (src/lib/money/refunds.ts) -- there is no subject-agnostic API.
 * `subject.type` picks which door this form knocks on.
 *
 * THE DONOR DESTINATION IS RECORDED HERE (Q7(c), ADR 0018 Amendment
 * 2026-09-28, moved from completion where ticket 31 first put it): there is
 * no saved BankAccount for a Guest Donor to check with a Verifier, so this
 * Admin -- the first of Rilis 1's two pairs of eyes -- reads the Donor's
 * written request and types the bank code, the account holder name, and
 * the account number here. The server refuses an approval with any of the
 * three left blank (REFUND_DESTINATION_INVALID). Once submitted, the
 * completing Admin re-types only the account number from the same written
 * request; this form never shows it back.
 */

interface RefundSubject {
  type: 'campaign' | 'trip';
  slug: string;
}

interface AdminRefundApproveFormProps {
  refundId: string;
  subject: RefundSubject;
  /** The signed-in Admin viewing this form. */
  actorId: string;
  requestedById: string;
  /** The signed-in Admin is this Campaign's or Volunteer Trip's Fundraiser (OwnSubjectConflictError, 403). */
  isOwnSubject: boolean;
}

function approveUrl(subject: RefundSubject, refundId: string): string {
  const base = subject.type === 'campaign' ? '/api/campaigns' : '/api/volunteer-trips';
  return `${base}/${subject.slug}/refunds/${refundId}/approve`;
}

export function AdminRefundApproveForm({ refundId, subject, actorId, requestedById, isOwnSubject }: AdminRefundApproveFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const [bankCode, setBankCode] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  if (isOwnSubject) {
    return <OwnSubjectNotice subjectType={subject.type} />;
  }

  if (actorId === requestedById) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Anda yang membuat Refund ini, jadi tidak bisa menyetujuinya sendiri -- aturan dua orang yang sama
        membutuhkan Admin lain.
      </p>
    );
  }

  const canApprove = bankCode.trim() !== '' && accountName.trim() !== '' && accountNumber.trim() !== '' && !submitting;

  async function approve() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(approveUrl(subject, refundId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donorBankCode: bankCode,
          donorAccountName: accountName,
          donorAccountNumber: accountNumber,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menyetujui refund.');
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal menyetujui refund.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Rekening tujuan Donor (dicatat dari permintaan tertulis Donor): tidak ada Bank Account tersimpan untuk
        Donor, jadi Admin yang menyetujui mengisinya di sini. Admin yang menyelesaikan nanti mengetik ulang nomor
        rekening ini dari permintaan yang sama.
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

      <button
        type="button"
        disabled={!canApprove}
        onClick={approve}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Setujui Refund
      </button>

      {refusal && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
