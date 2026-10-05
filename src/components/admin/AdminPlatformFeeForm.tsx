'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sets one Platform Fee rule or the waiver threshold (ticket 88; CONTEXT.md,
 * Platform Fee). Posts, unchanged, to the existing POST /api/admin/platform-fee
 * route. This form holds no rate and no threshold of its own: the percent an
 * Admin types is only converted to basis points (the unit the route takes),
 * and validation -- a whole number of basis points from 0 to 10000, a
 * non-negative whole rupiah -- lives only on the server, whose refusal is
 * shown here in its own words.
 */

type Target = 'KIND' | 'CATEGORY' | 'CAMPAIGN' | 'THRESHOLD';

const KINDS = ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'] as const;

/** "2,5" or "2.5" -> 250. Pure string arithmetic, so no float ever touches a rate. */
function percentToBps(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}

export function AdminPlatformFeeForm() {
  const router = useRouter();
  const [target, setTarget] = useState<Target>('KIND');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('DONATION');
  const [category, setCategory] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const percentBps = percentToBps(percent);
  const body =
    target === 'THRESHOLD'
      ? amount !== ''
        ? { target: 'threshold', amount: Number(amount) }
        : null
      : percentBps === null
        ? null
        : target === 'KIND'
          ? { target: 'rule', scope: 'KIND', kind, percentBps }
          : target === 'CATEGORY' && category.trim() !== ''
            ? { target: 'rule', scope: 'CATEGORY', category: category.trim(), percentBps }
            : target === 'CAMPAIGN' && campaignId.trim() !== ''
              ? { target: 'rule', scope: 'CAMPAIGN', campaignId: campaignId.trim(), percentBps }
              : null;
  const canSave = body !== null && !submitting;

  async function save() {
    if (!body) return;
    setSubmitting(true);
    setRefusal(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/platform-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const refused = await res.json().catch(() => ({}));
        setRefusal(typeof refused.error === 'string' && refused.error !== '' ? refused.error : 'Gagal menyimpan aturan.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setRefusal('Gagal menyimpan aturan.');
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
          <option value="KIND">Aturan per Kind</option>
          <option value="CATEGORY">Override per Category</option>
          <option value="CAMPAIGN">Override per Campaign</option>
          <option value="THRESHOLD">Ambang pembebasan</option>
        </select>
      </label>

      {target === 'KIND' && (
        <label className="block text-sm text-gray-700">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} className={inputClass}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      )}

      {target === 'CATEGORY' && (
        <label className="block text-sm text-gray-700">
          Category
          <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
        </label>
      )}

      {target === 'CAMPAIGN' && (
        <label className="block text-sm text-gray-700">
          ID Campaign
          <input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={inputClass} />
        </label>
      )}

      {target === 'THRESHOLD' ? (
        <label className="block text-sm text-gray-700">
          Ambang (rupiah)
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-gray-400">
            Donation di bawah nominal ini tidak dikenai Platform Fee.
          </span>
        </label>
      ) : (
        <label className="block text-sm text-gray-700">
          Persen (%)
          <input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className={inputClass} />
          <span className="mt-1 block text-xs text-gray-400">
            Boleh dua desimal. Berlaku untuk Donation sesudahnya; Payment yang sudah dibuat tetap memakai fee-nya sendiri.
          </span>
        </label>
      )}

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
