'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CampaignStatus } from '@/generated/prisma/client';

/**
 * The Admin screen for Suspension and Cancellation (ticket 25; ADR 0015;
 * CONTEXT.md, Suspension and Cancellation): reaches suspendCampaign,
 * liftSuspension and decideCancellation
 * (src/lib/campaign-lifecycle.ts) through their existing HTTP adapters
 * (POST/DELETE .../suspension, POST .../cancellation-requests/[id]/approve
 * or /reject). The server is the only holder of every rule this form asks
 * about -- who may act, from which status, the two-pairs-of-hands rule on a
 * lift -- so nothing here decides a Campaign's fate. What this form adds is
 * asking for a reason before submitting (every one of these commands
 * requires one) and showing the server's own refusal, in its own words,
 * when it says no. The same choice AdminPayoutActionForm makes.
 *
 * INDEPENDENT SECTIONS, NOT A WIZARD. A Campaign can be effectively
 * ACTIVE with open Flags and a pending Cancellation request at once (a
 * Verifier's Flag and a Fundraiser's own Cancellation ask are unrelated),
 * so this renders whichever of the forms currently applies, each with its
 * own reason field: dismiss an open Flag (rilis-1-benda 66), suspend
 * (SUSPENDABLE status), lift (SUSPENDED), decide a pending Cancellation
 * request, and set or clear Urgent (rilis-1-benda 66). `isOwnCampaign` and
 * `suspendedBySameAdmin` are read here only to show a sentence explaining
 * why up front -- OwnSubjectConflictError and SameAdminLiftError
 * (src/lib/capacity.ts, src/lib/campaign-lifecycle-errors.ts) are what
 * actually refuse it, exactly as CampaignPayoutPanel and
 * AdminPayoutActionForm already do for their own two-person rules.
 *
 * The Flag and Urgent sections of rilis-1-benda 66 go one step further and
 * read neither: dismissFlag and setUrgent (same module) refuse an Admin on
 * their own Campaign, and setUrgent refuses to set Urgent from any status but
 * Active, so those rules stay with the server and arrive here as the refusal
 * it sends. Only what the Admin needs to decide arrives as props: the open
 * Flags, whether the Campaign is Urgent, and whether Urgent can be set.
 */

/** An open Flag as the screen shows it; `flaggedAtLabel` is when it was raised, already formatted by the page. */
type OpenFlag = { id: string; reason: string; verifierName: string; flaggedAtLabel: string };
type PendingCancellationRequest = { id: string; reason: string; requestedByName: string | null };

interface AdminCampaignLifecycleActionsProps {
  campaignSlug: string;
  /** The Campaign's effective status (src/lib/subject-guard.ts effectiveStatus). */
  status: CampaignStatus;
  /**
   * Whether `status` is one an Admin may suspend from, decided server-side by
   * the lifecycle module's own list (SUSPENDABLE, ADR 0015) so this form never
   * keeps a second copy of it.
   */
  canSuspend: boolean;
  /** The signed-in Admin is this Campaign's Fundraiser (OwnSubjectConflictError). */
  isOwnCampaign: boolean;
  /** The signed-in Admin is the one who imposed the current Suspension (SameAdminLiftError). */
  suspendedBySameAdmin: boolean;
  openFlags: OpenFlag[];
  /** The Campaign is Urgent now (Campaign.isUrgent). */
  isUrgent: boolean;
  /**
   * Whether `status` is one Urgent can be set from, decided server-side by the
   * lifecycle module's own list (URGENT_SETTABLE_FROM) so this form never keeps
   * a second copy of it. Clearing Urgent does not depend on it.
   */
  canSetUrgent: boolean;
  pendingCancellationRequest: PendingCancellationRequest | null;
}

function OwnCampaignNote() {
  return (
    <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Anda adalah Fundraiser Campaign ini, jadi tidak bisa bertindak sebagai Admin atas Campaign milik Anda
      sendiri -- tindakan ini harus dilakukan Admin lain.
    </p>
  );
}

function Refusal({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}

export function AdminCampaignLifecycleActions({
  campaignSlug,
  status,
  canSuspend,
  isOwnCampaign,
  suspendedBySameAdmin,
  openFlags,
  isUrgent,
  canSetUrgent,
  pendingCancellationRequest,
}: AdminCampaignLifecycleActionsProps) {
  return (
    <div className="space-y-6">
      {openFlags.length > 0 && <FlagsSection campaignSlug={campaignSlug} flags={openFlags} />}

      {status === 'SUSPENDED' ? (
        <LiftSuspensionSection
          campaignSlug={campaignSlug}
          isOwnCampaign={isOwnCampaign}
          suspendedBySameAdmin={suspendedBySameAdmin}
        />
      ) : (
        canSuspend && <SuspendSection campaignSlug={campaignSlug} isOwnCampaign={isOwnCampaign} />
      )}

      {pendingCancellationRequest && (
        <CancellationDecisionSection
          campaignSlug={campaignSlug}
          isOwnCampaign={isOwnCampaign}
          request={pendingCancellationRequest}
        />
      )}

      {(isUrgent || canSetUrgent) && <UrgentSection campaignSlug={campaignSlug} isUrgent={isUrgent} />}
    </div>
  );
}

async function postJson(url: string, method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown>) {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The sentence the server refused with, or `fallback` when its answer carries none. */
async function refusalOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === 'string' && body.error !== '' ? body.error : fallback;
}

function FlagsSection({ campaignSlug, flags }: { campaignSlug: string; flags: OpenFlag[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Flag terbuka</h2>
      <p className="text-xs text-gray-500">
        Flag dari Verifier meminta Admin mempertimbangkan Suspension. Sebuah Flag berakhir karena Suspension atau
        ditolak Admin beserta alasannya.
      </p>
      <ul className="space-y-3">
        {flags.map((flag) => (
          <FlagItem key={flag.id} campaignSlug={campaignSlug} flag={flag} />
        ))}
      </ul>
    </section>
  );
}

function FlagItem({ campaignSlug, flag }: { campaignSlug: string; flag: OpenFlag }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const flagReasonId = `flag-${flag.id}-reason`;
  const dismissalId = `flag-${flag.id}-dismissal`;

  async function dismiss() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await postJson(`/api/campaigns/${campaignSlug}/flags/${flag.id}/dismiss`, 'POST', { reason });
      if (!res.ok) {
        setRefusal(await refusalOf(res, 'Gagal menolak Flag.'));
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal menolak Flag.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="space-y-3 rounded-lg bg-red-50 p-3 text-sm">
      <div>
        <p id={flagReasonId} className="text-red-800">
          {flag.reason}
        </p>
        <p className="mt-1 text-xs text-red-700">
          Dipasang oleh {flag.verifierName}, {flag.flaggedAtLabel}
        </p>
      </div>

      <div>
        <label htmlFor={dismissalId} className="block text-gray-700">
          Alasan penolakan Flag
        </label>
        <textarea
          id={dismissalId}
          aria-describedby={flagReasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
        />
      </div>

      <button
        type="button"
        disabled={reason.trim() === '' || submitting}
        onClick={dismiss}
        className="w-full rounded-lg bg-gray-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Tolak Flag
      </button>

      <Refusal message={refusal} />
    </li>
  );
}

function SuspendSection({ campaignSlug, isOwnCampaign }: { campaignSlug: string; isOwnCampaign: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (isOwnCampaign) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Suspension</h2>
        <OwnCampaignNote />
      </section>
    );
  }

  async function submit() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await postJson(`/api/campaigns/${campaignSlug}/suspension`, 'POST', { reason });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menjatuhkan Suspension.');
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal menjatuhkan Suspension.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Suspension</h2>

      <label className="block text-sm text-gray-700">
        Alasan Suspension
        <textarea
          aria-label="Alasan Suspension"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Wajib diisi walau tanpa Flag, selama alasannya tercatat"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <button
        type="button"
        disabled={reason.trim() === '' || submitting}
        onClick={submit}
        className="w-full rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Jatuhkan Suspension
      </button>

      <Refusal message={refusal} />
    </section>
  );
}

function LiftSuspensionSection({
  campaignSlug,
  isOwnCampaign,
  suspendedBySameAdmin,
}: {
  campaignSlug: string;
  isOwnCampaign: boolean;
  suspendedBySameAdmin: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (isOwnCampaign) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Suspension</h2>
        <OwnCampaignNote />
      </section>
    );
  }

  if (suspendedBySameAdmin) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Suspension</h2>
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Anda yang menjatuhkan Suspension ini, jadi tidak bisa mencabutnya sendiri -- pencabutan harus dilakukan
          Admin lain.
        </p>
      </section>
    );
  }

  async function submit() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await postJson(`/api/campaigns/${campaignSlug}/suspension`, 'DELETE', { reason });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal mencabut Suspension.');
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal mencabut Suspension.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Suspension</h2>

      <label className="block text-sm text-gray-700">
        Alasan pencabutan
        <textarea
          aria-label="Alasan pencabutan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <button
        type="button"
        disabled={reason.trim() === '' || submitting}
        onClick={submit}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Cabut Suspension
      </button>

      <Refusal message={refusal} />
    </section>
  );
}

function CancellationDecisionSection({
  campaignSlug,
  isOwnCampaign,
  request,
}: {
  campaignSlug: string;
  isOwnCampaign: boolean;
  request: PendingCancellationRequest;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (isOwnCampaign) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Pengajuan Cancellation</h2>
        <OwnCampaignNote />
      </section>
    );
  }

  async function decide(decision: 'approve' | 'reject') {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await postJson(
        `/api/campaigns/${campaignSlug}/cancellation-requests/${request.id}/${decision}`,
        'POST',
        { reason },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(
          typeof body.error === 'string' && body.error !== ''
            ? body.error
            : 'Gagal memutuskan pengajuan Cancellation.',
        );
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal memutuskan pengajuan Cancellation.');
    } finally {
      setSubmitting(false);
    }
  }

  const canDecide = reason.trim() !== '' && !submitting;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Pengajuan Cancellation</h2>

      <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
        <p className="text-xs text-gray-500">Diajukan oleh {request.requestedByName ?? 'Fundraiser'}</p>
        <p>{request.reason}</p>
      </div>

      <label className="block text-sm text-gray-700">
        Alasan keputusan
        <textarea
          aria-label="Alasan keputusan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canDecide}
          onClick={() => decide('approve')}
          className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Setujui Cancellation
        </button>
        <button
          type="button"
          disabled={!canDecide}
          onClick={() => decide('reject')}
          className="flex-1 rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Tolak Cancellation
        </button>
      </div>

      <Refusal message={refusal} />
    </section>
  );
}

function UrgentSection({ campaignSlug, isUrgent }: { campaignSlug: string; isUrgent: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function toggle() {
    const setting = !isUrgent;
    setSubmitting(true);
    setRefusal(null);
    setConfirmation(null);
    try {
      const res = await postJson(`/api/campaigns/${campaignSlug}/urgent`, 'PUT', { urgent: setting, reason });
      if (!res.ok) {
        setRefusal(await refusalOf(res, setting ? 'Gagal memasang Urgent.' : 'Gagal melepas Urgent.'));
        return;
      }
      setReason('');
      setConfirmation(setting ? 'Urgent dipasang.' : 'Urgent dilepas.');
      router.refresh();
    } catch {
      setRefusal(setting ? 'Gagal memasang Urgent.' : 'Gagal melepas Urgent.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Urgent</h2>
      <p className="text-xs text-gray-500">
        Urgent menonjolkan Campaign Active di beranda dan penjelajahan sebagai mendesak.
      </p>
      <p className="text-sm text-gray-700">{isUrgent ? 'Campaign ini sedang Urgent.' : 'Campaign ini tidak Urgent.'}</p>

      <label className="block text-sm text-gray-700">
        {isUrgent ? 'Alasan melepas Urgent' : 'Alasan memasang Urgent'}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
      </label>

      <button
        type="button"
        disabled={reason.trim() === '' || submitting}
        onClick={toggle}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isUrgent ? 'Lepas Urgent' : 'Pasang Urgent'}
      </button>

      {confirmation && (
        <p role="status" className="text-sm text-green-700">
          {confirmation}
        </p>
      )}
      <Refusal message={refusal} />
    </section>
  );
}
