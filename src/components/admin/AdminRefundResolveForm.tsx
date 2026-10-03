'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The way back for a Refund, on the Admin's screen (ticket 50, on top of the
 * routes of ticket 49; CONTEXT.md, Refund): an Admin REJECTS a Refund that is
 * not yet approved, or marks an APPROVED one FAILED because the Donor could
 * not be paid. Either returns the Frozen Balance (CONTEXT.md) to the balance
 * it came from, as a reversing journal the server posts (rejectRefund /
 * failRefund, src/lib/money/refunds.ts) -- this form never reads or computes
 * a balance.
 *
 * One form for both acts, because they differ only in the door they knock on
 * and the words around it: `action` is also the last segment of the route
 * (PATCH .../refunds/[id]/reject or /fail), and `subject.type` picks the
 * Campaign or Volunteer Trip route tree, the same two-door shape
 * AdminRefundApproveForm and AdminRefundCompleteForm already have.
 *
 * The server is the only holder of every rule: which statuses each act
 * accepts (409 INVALID_REFUND_STATUS, also for a second click or a lost
 * race), who is barred (403), and the reason's length (400). What this form
 * adds is asking for the reason before it submits, saying up front why a
 * button is not offered -- the same choice AdminRefundApproveForm makes --
 * and showing the server's own sentence, unchanged, when it refuses.
 *
 * WHO IS BARRED, per act (CONTEXT.md, Refund; rejectRefund / failRefund
 * judge the same lists under the subject's lock):
 *   - reject: the Admin who requested the Refund (`requestedById`), and the
 *     Fundraiser of its Campaign or Volunteer Trip (`isOwnSubject`).
 *   - fail: the Admin who approved the Refund (`approvedById`), and the
 *     Fundraiser. The requester is NOT barred from failing.
 * The two lists are not symmetric on purpose, so they are not folded into
 * one "two-person" check. `isOwnSubject` is decided by the page from the
 * subject's own owner; it is read here only for the sentence, the way
 * `isOwnCampaign` is in AdminCampaignLifecycleActions.
 *
 * The reason is required and typed by the Admin; blank is stopped here only
 * so nobody is sent to the server to be told an empty field is empty. Its
 * maximum length is the server's (400, REFUND_REASON_INVALID) and arrives as
 * the refusal -- the number is not copied into this client component.
 */

type ResolveAction = 'reject' | 'fail';

interface RefundSubject {
  type: 'campaign' | 'trip';
  slug: string;
}

interface AdminRefundResolveFormProps {
  action: ResolveAction;
  refundId: string;
  subject: RefundSubject;
  /** The signed-in Admin viewing this form. */
  actorId: string;
  requestedById: string;
  approvedById: string | null;
  /** The signed-in Admin is this Campaign's or Volunteer Trip's Fundraiser (OwnSubjectConflictError). */
  isOwnSubject: boolean;
}

const COPY = {
  reject: {
    label: 'Alasan penolakan',
    button: 'Tolak Refund',
    failure: 'Gagal menolak refund.',
    barredNotice:
      'Anda yang mengajukan Refund ini, jadi tidak bisa menolaknya sendiri -- penolakan harus dilakukan Admin lain.',
  },
  fail: {
    label: 'Alasan kegagalan',
    button: 'Tandai Refund gagal',
    failure: 'Gagal menandai refund gagal.',
    barredNotice:
      'Anda yang menyetujui Refund ini, jadi tidak bisa menandainya gagal sendiri -- penandaan gagal harus dilakukan Admin lain.',
  },
} as const;

const SUBJECT_NAME = { campaign: 'Campaign', trip: 'Volunteer Trip' } as const;

function Notice({ children }: { children: string }) {
  return <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{children}</p>;
}

export function AdminRefundResolveForm({
  action,
  refundId,
  subject,
  actorId,
  requestedById,
  approvedById,
  isOwnSubject,
}: AdminRefundResolveFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const copy = COPY[action];

  if (isOwnSubject) {
    const name = SUBJECT_NAME[subject.type];
    return (
      <Notice>
        {`Anda adalah Fundraiser ${name} ini, jadi tidak bisa bertindak sebagai Admin atas ${name} milik Anda sendiri -- tindakan ini harus dilakukan Admin lain.`}
      </Notice>
    );
  }

  const barredActorId = action === 'reject' ? requestedById : approvedById;
  if (actorId === barredActorId) {
    return <Notice>{copy.barredNotice}</Notice>;
  }

  const canSubmit = reason.trim() !== '' && !submitting;

  async function submit() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const base = subject.type === 'campaign' ? '/api/campaigns' : '/api/volunteer-trips';
      const res = await fetch(`${base}/${subject.slug}/refunds/${refundId}/${action}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : copy.failure);
        return;
      }
      router.refresh();
    } catch {
      setRefusal(copy.failure);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-700">
        {copy.label}
        <textarea
          aria-label={copy.label}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-50"
      >
        {copy.button}
      </button>

      {refusal && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
