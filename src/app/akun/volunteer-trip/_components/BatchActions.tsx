'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BatchForm, type BatchFormValues } from './BatchForm';
import { sendJson } from './api';

export type RosterEntry = { id: string; name: string };

/**
 * What a Fundraiser does to an OPEN Batch: change its dates and quotas,
 * cancel it (the server refuses unless the minimum quota was missed, and says
 * so; each paid Registration is then refunded in full), or, once its end date
 * has passed, complete it by ticking who attended. Everyone starts ticked
 * (decision Q4); an unticked Volunteer gets no certificate. The rules are
 * cancelBatch's and completeBatch's, so each refusal is shown as it comes.
 * Client component: talks to the API only.
 */
export function BatchActions({
  slug,
  batchId,
  values,
  ended,
  roster,
  seatsUsed,
}: {
  slug: string;
  batchId: string;
  values: BatchFormValues;
  ended: boolean;
  roster: RosterEntry[];
  seatsUsed: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [attended, setAttended] = useState<Set<string>>(() => new Set(roster.map((r) => r.id)));

  async function act(body: Record<string, unknown>) {
    setPending(true);
    setError('');
    const result = await sendJson(`/api/volunteer-trips/${slug}/batches/${batchId}`, 'PATCH', body);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  function toggle(id: string) {
    setAttended((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-[#C62828]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setEditing((open) => !open)}
          className="px-3 py-1.5 text-sm rounded-lg border border-border text-text"
        >
          {editing ? 'Tutup' : 'Ubah Batch'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void act({ action: 'cancel' })}
          className="px-3 py-1.5 text-sm rounded-lg border border-[#C62828] text-[#C62828] disabled:opacity-50"
        >
          Batalkan Batch
        </button>
      </div>
      {editing && <BatchForm slug={slug} batchId={batchId} initial={values} seatsUsed={seatsUsed} onDone={() => setEditing(false)} />}

      <fieldset className="space-y-2 border-t border-border pt-3">
        <legend className="text-sm font-semibold text-text">Selesaikan Batch</legend>
        {!ended && (
          <p className="text-sm text-text-secondary">Batch baru bisa diselesaikan setelah tanggal selesainya lewat.</p>
        )}
        {roster.length === 0 ? (
          <p className="text-sm text-text-secondary">Belum ada Registration CONFIRMED.</p>
        ) : (
          <>
            <p className="text-xs text-text-secondary">
              Centang yang hadir. Yang tidak dicentang tidak menerima Sertifikat Keikutsertaan.
            </p>
            <ul className="space-y-1">
              {roster.map((entry) => (
                <li key={entry.id}>
                  <label className="flex items-center gap-2 text-sm text-[#424242]">
                    <input type="checkbox" checked={attended.has(entry.id)} onChange={() => toggle(entry.id)} />
                    {entry.name}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          type="button"
          disabled={pending || !ended}
          onClick={() => void act({ action: 'complete', attendedRegistrationIds: roster.filter((r) => attended.has(r.id)).map((r) => r.id) })}
          className="px-4 py-2 bg-[#2E7D32] text-white text-sm font-medium rounded-lg disabled:opacity-50"
        >
          Selesaikan Batch
        </button>
      </fieldset>
    </div>
  );
}
