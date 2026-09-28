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
 * THREE INDEPENDENT SECTIONS, NOT A WIZARD. A Campaign can be effectively
 * ACTIVE with open Flags and a pending Cancellation request at once (a
 * Verifier's Flag and a Fundraiser's own Cancellation ask are unrelated),
 * so this renders whichever of the three forms currently applies, each with
 * its own reason field: suspend (SUSPENDABLE status), lift (SUSPENDED), and
 * decide a pending Cancellation request. `isOwnCampaign` and
 * `suspendedBySameAdmin` are read here only to show a sentence explaining
 * why up front -- OwnSubjectConflictError and SameAdminLiftError
 * (src/lib/capacity.ts, src/lib/campaign-lifecycle-errors.ts) are what
 * actually refuse it, exactly as CampaignPayoutPanel and
 * AdminPayoutActionForm already do for their own two-person rules.
 */

type OpenFlag = { id: string; reason: string };
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
  pendingCancellationRequest,
}: AdminCampaignLifecycleActionsProps) {
  return (
    <div className="space-y-6">
      {status === 'SUSPENDED' ? (
        <LiftSuspensionSection
          campaignSlug={campaignSlug}
          isOwnCampaign={isOwnCampaign}
          suspendedBySameAdmin={suspendedBySameAdmin}
        />
      ) : (
        canSuspend && (
          <SuspendSection campaignSlug={campaignSlug} isOwnCampaign={isOwnCampaign} openFlags={openFlags} />
        )
      )}

      {pendingCancellationRequest && (
        <CancellationDecisionSection
          campaignSlug={campaignSlug}
          isOwnCampaign={isOwnCampaign}
          request={pendingCancellationRequest}
        />
      )}
    </div>
  );
}

async function postJson(url: string, method: 'POST' | 'DELETE', body: Record<string, unknown>) {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function SuspendSection({
  campaignSlug,
  isOwnCampaign,
  openFlags,
}: {
  campaignSlug: string;
  isOwnCampaign: boolean;
  openFlags: OpenFlag[];
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

      {openFlags.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {openFlags.map((flag) => (
            <li key={flag.id}>{flag.reason}</li>
          ))}
        </ul>
      )}

      <label className="block text-sm text-gray-700">
        Alasan Suspension
        <textarea
          aria-label="Alasan Suspension"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Wajib diisi walau tanpa Flag, selama alasannya tercatat (ADR 0015)"
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
          Admin lain (ADR 0015).
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
