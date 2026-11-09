'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Tandai selesai" for a webhook event in the /admin/reconciliation review
 * queue (PKS pemenuhan 05). Posts to POST /api/admin/webhook-events/[id]/resolve.
 * The note is required and says what was done at the provider's dashboard; the
 * button stays disabled until there is one, and the server's own refusal (an
 * event already closed by another Admin, for one) is shown as it is worded.
 */
export function AdminResolveWebhookForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function resolve() {
    if (note.trim() === '') return;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fetch(`/api/admin/webhook-events/${eventId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRefusal(body.error ?? 'Gagal menandai selesai. Coba lagi.');
        return;
      }
      setNote('');
      router.refresh();
    } catch {
      setRefusal('Gagal menandai selesai. Periksa koneksi lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-[14rem] flex-col gap-1">
      <input
        aria-label="Catatan penyelesaian"
        placeholder="Apa yang sudah dilakukan"
        value={note}
        maxLength={1000}
        onChange={(e) => setNote(e.target.value)}
        className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={resolve}
        disabled={busy || note.trim() === ''}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Menyimpan...' : 'Tandai selesai'}
      </button>
      {refusal && (
        <p role="alert" className="text-xs text-red-700">
          {refusal}
        </p>
      )}
    </div>
  );
}
