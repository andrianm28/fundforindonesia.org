'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The Admin control for a Volunteer Trip's Suspension (ticket 38; CONTEXT.md,
 * Suspension): reaches suspendTrip and liftTripSuspension
 * (src/lib/volunteer/trip.ts) through POST and DELETE
 * /api/admin/volunteer-trips/[id]/suspension. The server is the only holder
 * of every rule -- Admin only, never on your own Trip, never the Admin who
 * imposed the Suspension for a lift, which status -- so nothing here decides
 * a Trip's fate. This asks for a reason, says up front why a control is not
 * offered (`isOwnTrip`, `suspendedBySameAdmin`, read only for that sentence),
 * and shows the server's own refusal when it says no, as
 * AdminCampaignLifecycleActions does for a Campaign.
 */

interface AdminTripSuspensionActionProps {
  tripId: string;
  mode: 'suspend' | 'lift';
  /** The signed-in Admin is this Trip's Fundraiser (OwnSubjectConflictError). */
  isOwnTrip: boolean;
  /** The signed-in Admin imposed the current Suspension (SameAdminLiftError). */
  suspendedBySameAdmin: boolean;
}

const COPY = {
  suspend: {
    label: 'Alasan penangguhan',
    button: 'Tangguhkan Trip',
    method: 'POST',
    failure: 'Gagal menangguhkan Trip.',
  },
  lift: {
    label: 'Alasan pencabutan',
    button: 'Cabut Penangguhan',
    method: 'DELETE',
    failure: 'Gagal mencabut penangguhan.',
  },
} as const;

export function AdminTripSuspensionAction({ tripId, mode, isOwnTrip, suspendedBySameAdmin }: AdminTripSuspensionActionProps) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const copy = COPY[mode];

  if (isOwnTrip) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Anda adalah Fundraiser Volunteer Trip ini, jadi tidak bisa bertindak sebagai Admin atasnya -- tindakan ini
        harus dilakukan Admin lain.
      </p>
    );
  }

  if (mode === 'lift' && suspendedBySameAdmin) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Anda yang menangguhkan Trip ini, jadi tidak bisa mencabutnya sendiri -- pencabutan harus dilakukan Admin lain.
      </p>
    );
  }

  async function submit() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/admin/volunteer-trips/${tripId}/suspension`, {
        method: copy.method,
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
    <div className="space-y-2">
      <textarea
        aria-label={copy.label}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={copy.label}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={reason.trim() === '' || submitting}
        onClick={submit}
        className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
          mode === 'suspend' ? 'bg-danger' : 'bg-primary'
        }`}
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
