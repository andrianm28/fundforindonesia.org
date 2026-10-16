'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sets the Escrow Hold length, default or per Category (ticket 90; CONTEXT.md,
 * Escrow Hold). Posts to POST /api/admin/escrow-hold. The bounds live only on
 * the server, whose refusal is shown here in its own words; this form only
 * keeps the field to digits.
 */

type Target = 'DEFAULT' | 'CATEGORY';

export function AdminEscrowHoldForm() {
  const router = useRouter();
  const [target, setTarget] = useState<Target>('DEFAULT');
  const [category, setCategory] = useState('');
  const [days, setDays] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const body =
    days === ''
      ? null
      : target === 'DEFAULT'
        ? { scope: 'DEFAULT', days: Number(days) }
        : category.trim() !== ''
          ? { scope: 'CATEGORY', category: category.trim(), days: Number(days) }
          : null;
  const canSave = body !== null && !submitting;

  async function save() {
    if (!body) return;
    setSubmitting(true);
    setRefusal(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/escrow-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const refused = await res.json().catch(() => ({}));
        setRefusal(typeof refused.error === 'string' && refused.error !== '' ? refused.error : 'Gagal menyimpan lama tahan.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setRefusal('Gagal menyimpan lama tahan.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2';

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-700">
        Yang diubah
        <select value={target} onChange={(e) => setTarget(e.target.value as Target)} className={inputClass}>
          <option value="DEFAULT">Default</option>
          <option value="CATEGORY">Override per Category</option>
        </select>
      </label>

      {target === 'CATEGORY' && (
        <label className="block text-sm text-gray-700">
          Category
          <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
        </label>
      )}

      <label className="block text-sm text-gray-700">
        Lama tahan (hari)
        <input
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
          className={inputClass}
        />
        <span className="mt-1 block text-xs text-gray-400">
          Berlaku untuk Payment sesudahnya; Payment yang sudah dibuat tetap memakai lama tahannya sendiri.
        </span>
      </label>

      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Simpan
      </button>

      {saved && (
        <p role="status" className="text-sm text-green-700">
          Tersimpan sebagai baris baru di riwayat.
        </p>
      )}
      {refusal && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
