'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PrayerModerationAction } from '@/lib/prayer-moderation';

export interface PrayerRowData {
  id: string;
  text: string;
  amiinCount: number;
  createdAt: string;
  campaignSlug: string;
  campaignTitle: string;
  hidden: boolean;
  hiddenAt: string | null;
  hiddenByName: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB';

/**
 * The Prayer moderation list (PKS Pasal 3.7c), shared by the Verifier's screen
 * (/moderasi/doa) and the Admin's (/admin/doa). Each row has the buttons that
 * make sense for it: Sembunyikan on a visible Prayer, Tampilkan on a hidden
 * one, Hapus on either. Deleting asks first, because it cannot be undone from
 * here. The server records who acted and when; a refusal is shown in its words.
 */
export function PrayerModerationList({ prayers, filter, basePath }: { prayers: PrayerRowData[]; filter: 'visible' | 'hidden'; basePath: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(id: string, action: PrayerModerationAction) {
    if (action === 'delete' && !window.confirm('Hapus doa ini? Doa yang dihapus tidak bisa ditampilkan lagi.')) return;
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/moderasi/prayers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error ?? 'Gagal. Coba lagi.');
      } else {
        router.refresh();
      }
    } catch {
      setMessage('Gagal. Periksa koneksi lalu coba lagi.');
    } finally {
      setBusyId(null);
    }
  }

  const button = 'rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50';

  return (
    <div>
      <div className="mb-4 flex gap-2" role="group" aria-label="Filter doa">
        {(['visible', 'hidden'] as const).map((option) => (
          <a
            key={option}
            href={`${basePath}?filter=${option}`}
            aria-current={filter === option ? 'page' : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm ${filter === option ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text'}`}
          >
            {option === 'visible' ? 'Tampil' : 'Disembunyikan'}
          </a>
        ))}
      </div>

      {message && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {message}
        </p>
      )}

      {prayers.length === 0 ? (
        <p className="text-sm text-text-secondary">Tidak ada doa.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-white">
          {prayers.map((prayer) => (
            <li key={prayer.id} className="flex flex-col gap-2 p-4">
              <p className="whitespace-pre-line break-words text-sm text-text">{prayer.text}</p>
              <p className="text-xs text-text-secondary">
                {prayer.campaignTitle} · {when(prayer.createdAt)} · {prayer.amiinCount} Aamiin
                {prayer.hidden && prayer.hiddenAt && (
                  <> · disembunyikan {when(prayer.hiddenAt)}{prayer.hiddenByName ? ` oleh ${prayer.hiddenByName}` : ''}</>
                )}
              </p>
              <div className="flex gap-2">
                {prayer.hidden ? (
                  <button type="button" className={button} disabled={busyId === prayer.id} onClick={() => act(prayer.id, 'show')}>
                    Tampilkan
                  </button>
                ) : (
                  <button type="button" className={button} disabled={busyId === prayer.id} onClick={() => act(prayer.id, 'hide')}>
                    Sembunyikan
                  </button>
                )}
                <button type="button" className={`${button} text-red-600`} disabled={busyId === prayer.id} onClick={() => act(prayer.id, 'delete')}>
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
