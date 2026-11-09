'use client';

import { useState } from 'react';
import { MAX_PAYOUT_NOTE_LENGTH } from '@/lib/payout-limits';

/**
 * The supporting papers, the Admin's revision reason and the resubmit control
 * of one Payout request (PKS Pasal 4.5; pks-pemenuhan/12), shown under a
 * Payout in the Fundraiser's history while it is DRAFT (papers may still be
 * added) or REVISION_REQUESTED (the Admin sent it back).
 *
 * Papers are private Documents: uploaded through POST /api/documents with this
 * Payout's id, opened through GET /api/documents/[id] (the ACL answers owner
 * and Admin only). The panel never sees a storage path. Nothing here moves
 * money: resubmitting only puts the request back in the Admin's queue.
 */

export interface PayoutPaper {
  id: string;
  label: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface PayoutSupportingPapersProps {
  payoutId: string;
  status: 'DRAFT' | 'REVISION_REQUESTED';
  note: string | null;
  revisionReason: string | null;
  documents: PayoutPaper[];
  /** Called after an upload or a resubmit so the panel reloads its read. */
  onChanged: () => void | Promise<void>;
}

export function PayoutSupportingPapers({
  payoutId,
  status,
  note,
  revisionReason,
  documents,
  onChanged,
}: PayoutSupportingPapersProps) {
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [newNote, setNewNote] = useState(note ?? '');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function fail(res: Response, generic: string) {
    const body = await res.json().catch(() => ({}));
    setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : generic);
  }

  async function upload() {
    if (!file || label.trim() === '' || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const form = new FormData();
      form.set('payoutId', payoutId);
      form.set('label', label.trim());
      form.set('file', file);
      const res = await fetch('/api/documents', { method: 'POST', body: form });
      if (!res.ok) {
        await fail(res, 'Gagal mengunggah dokumen.');
        return;
      }
      setLabel('');
      setFile(null);
      await onChanged();
    } catch {
      setRefusal('Gagal mengunggah dokumen.');
    } finally {
      setBusy(false);
    }
  }

  async function resubmit() {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/user/payouts/${payoutId}/resubmit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newNote }),
      });
      if (!res.ok) {
        await fail(res, 'Gagal mengajukan ulang pencairan.');
        return;
      }
      await onChanged();
    } catch {
      setRefusal('Gagal mengajukan ulang pencairan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
      {status === 'REVISION_REQUESTED' && (
        <div role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">Admin meminta revisi. Dana belum bergerak.</p>
          {revisionReason && <p className="mt-1">Alasan: {revisionReason}</p>}
        </div>
      )}

      {note && status === 'DRAFT' && <p className="text-xs text-text-secondary">Catatan Anda: {note}</p>}

      <p className="text-xs font-semibold text-text">Dokumen pendukung</p>
      {documents.length === 0 ? (
        <p className="text-xs text-text-secondary">Belum ada dokumen pendukung.</p>
      ) : (
        <ul className="space-y-1">
          {documents.map((doc) => (
            <li key={doc.id} className="text-xs">
              <a href={`/api/documents/${doc.id}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {doc.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-secondary">Dokumen bersifat privat: hanya Anda dan Admin yang dapat membukanya.</p>

      <label className="block text-xs text-text">
        Nama dokumen
        <input
          aria-label="Nama dokumen pendukung"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="mis. Nota pembelian"
          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-xs text-text">
        Berkas (PDF, JPEG, PNG, atau WebP, maks 10MB)
        <input
          aria-label="Berkas dokumen pendukung"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
      </label>
      <button
        type="button"
        onClick={upload}
        disabled={busy || !file || label.trim() === ''}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text disabled:opacity-50"
      >
        Unggah dokumen
      </button>

      {status === 'REVISION_REQUESTED' && (
        <div className="space-y-2 border-t border-border pt-2">
          <label className="block text-xs text-text">
            Catatan tambahan (opsional)
            <textarea
              aria-label="Catatan tambahan"
              value={newNote}
              maxLength={MAX_PAYOUT_NOTE_LENGTH}
              onChange={(e) => setNewNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={resubmit}
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Ajukan ulang
          </button>
        </div>
      )}

      {refusal && (
        <p role="alert" className="text-xs text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
