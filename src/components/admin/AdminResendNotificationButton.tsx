'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The "Kirim ulang" button of /admin/notifikasi-gagal (PKS Pasal 8(2)). Posts to
 * POST /api/admin/failed-notifications/[id]/resend, which sends the queued email
 * now and answers whether the provider accepted it. A refusal from the server is
 * shown in its own words; a send the provider refused again is said plainly,
 * because the row stays in the queue and the Admin should not think it went out.
 */
export function AdminResendNotificationButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/failed-notifications/${id}/resend`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { outcome?: string; error?: string };
      if (!res.ok) {
        setMessage(body.error ?? 'Gagal mengirim ulang. Coba lagi.');
      } else if (body.outcome === 'SENT') {
        setMessage('Terkirim.');
        router.refresh();
      } else {
        setMessage('Penyedia email menolak lagi. Galat terbaru tercatat di baris ini.');
        router.refresh();
      }
    } catch {
      setMessage('Gagal mengirim ulang. Periksa koneksi lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Mengirim...' : 'Kirim ulang'}
      </button>
      {message && (
        <p role="status" className="mt-1 text-xs text-gray-600">
          {message}
        </p>
      )}
    </div>
  );
}
