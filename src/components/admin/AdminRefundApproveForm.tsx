'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
}

function approveUrl(subject: RefundSubject, refundId: string): string {
  const base = subject.type === 'campaign' ? '/api/campaigns' : '/api/volunteer-trips';
  return `${base}/${subject.slug}/refunds/${refundId}/approve`;
}

export function AdminRefundApproveForm({ refundId, subject, actorId, requestedById }: AdminRefundApproveFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (actorId === requestedById) {
    return (
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Anda yang membuat Refund ini, jadi tidak bisa menyetujuinya sendiri -- aturan dua orang yang sama
        membutuhkan Admin lain.
      </p>
    );
  }

  async function approve() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(approveUrl(subject, refundId), { method: 'PATCH' });
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
      <button
        type="button"
        disabled={submitting}
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
