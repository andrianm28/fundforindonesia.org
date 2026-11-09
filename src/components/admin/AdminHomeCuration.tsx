'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Admin curation of the home page (PKS pemenuhan 15): three ordered lists,
 * "Pilihan Kami", "Unggulan kategori" and "Sorotan doa". Each is saved as a
 * whole through PUT /api/admin/kurasi. A mark only asks for a place on the
 * home page; a Campaign that is not Active, or a Prayer a moderator hid,
 * still does not show there.
 */

export interface CurationItem {
  id: string;
  label: string;
  /** Who marked it and when, or a status note; may be empty. */
  detail: string;
}

export interface AdminHomeCurationProps {
  pilihan: CurationItem[];
  unggulan: CurationItem[];
  sorotan: CurationItem[];
  /** Campaigns that can be marked (Active). */
  campaignOptions: CurationItem[];
  /** Public Prayers that can be marked. */
  prayerOptions: CurationItem[];
}

const BUTTON = 'rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40';

function SlotEditor(props: {
  slot: 'PILIHAN' | 'UNGGULAN_KATEGORI' | 'SOROTAN_DOA';
  title: string;
  help: string;
  noun: 'campaign' | 'doa';
  initial: CurationItem[];
  options: CurationItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(props.initial);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const available = props.options.filter((o) => !items.some((i) => i.id === o.id));

  function add() {
    const picked = props.options.find((o) => o.id === choice);
    if (!picked) return;
    setItems([...items, picked]);
    setChoice('');
  }

  function move(index: number, by: -1 | 1) {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    setItems(next);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/kurasi', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: props.slot, ids: items.map((i) => i.id) }),
      });
      if (!res.ok) {
        const answer = await res.json().catch(() => ({}));
        setMessage({ kind: 'error', text: answer.error ?? 'Perubahan gagal disimpan.' });
        return;
      }
      setMessage({ kind: 'ok', text: 'Tersimpan.' });
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: 'Tidak dapat menghubungi server.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={props.title} className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-gray-900">{props.title}</h2>
      <p className="mt-1 text-sm text-gray-600">{props.help}</p>

      {message?.kind === 'error' && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {message.text}
        </p>
      )}
      {message?.kind === 'ok' && <p className="mt-3 text-sm text-green-700">{message.text}</p>}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">Belum ada yang ditandai; beranda memakai urutan otomatis.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 rounded-md border border-gray-100 px-3 py-2">
              <span className="w-6 text-sm text-gray-500">{index + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-900">{item.label}</span>
                {item.detail && <span className="block text-xs text-gray-500">{item.detail}</span>}
              </span>
              <button type="button" className={BUTTON} disabled={index === 0} aria-label={`Naikkan ${item.label}`} onClick={() => move(index, -1)}>
                Naik
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={index === items.length - 1}
                aria-label={`Turunkan ${item.label}`}
                onClick={() => move(index, 1)}
              >
                Turun
              </button>
              <button
                type="button"
                className={BUTTON}
                aria-label={`Hapus ${item.label}`}
                onClick={() => setItems(items.filter((i) => i.id !== item.id))}
              >
                Hapus
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          aria-label={`Tambah ${props.noun}`}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="min-w-0 max-w-full flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Pilih {props.noun}...</option>
          {available.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className={BUTTON} onClick={add} disabled={!choice}>
          Tambah
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Simpan
        </button>
      </div>
    </section>
  );
}

export function AdminHomeCuration({ pilihan, unggulan, sorotan, campaignOptions, prayerOptions }: AdminHomeCurationProps) {
  return (
    <div className="space-y-6">
      <SlotEditor
        slot="PILIHAN"
        title="Pilihan Kami"
        help="Campaign yang tampil di bagian Pilihan Kami beranda, sesuai urutan ini. Kosong: beranda mengurutkan otomatis menurut dana terkumpul."
        noun="campaign"
        initial={pilihan}
        options={campaignOptions}
      />
      <SlotEditor
        slot="UNGGULAN_KATEGORI"
        title="Unggulan kategori"
        help="Campaign unggulan untuk kategorinya sendiri; beranda membuat satu bagian per kategori yang punya Campaign unggulan."
        noun="campaign"
        initial={unggulan}
        options={campaignOptions}
      />
      <SlotEditor
        slot="SOROTAN_DOA"
        title="Sorotan doa"
        help="Doa yang disorot di beranda, sesuai urutan ini. Doa yang disembunyikan atau dihapus moderator tidak tampil walau ditandai."
        noun="doa"
        initial={sorotan}
        options={prayerOptions}
      />
    </div>
  );
}
