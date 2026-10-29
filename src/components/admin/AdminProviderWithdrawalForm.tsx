'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Records a sweep from a Payment Provider to a Collection Account (ticket 63;
 * prd-compliance 35, ADR 0011). Posts to POST /api/admin/provider-withdrawals.
 * Every rule lives on the server (src/lib/money/provider-withdrawals.ts), whose
 * refusal is shown here in its own words; this form only keeps the rupiah
 * fields to digits so "1.000.000" as typed from a dashboard posts 1000000.
 */

type CollectingEntityOption = { id: string; name: string };

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

export function AdminProviderWithdrawalForm({
  providers,
  collectingEntities,
}: {
  providers: readonly string[];
  collectingEntities: CollectingEntityOption[];
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(providers[0] ?? '');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [collectingEntityId, setCollectingEntityId] = useState('');
  const [balanceBefore, setBalanceBefore] = useState('');
  const [balanceAfter, setBalanceAfter] = useState('');
  const [proofReference, setProofReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const complete =
    provider !== '' &&
    reference.trim() !== '' &&
    amount !== '' &&
    destinationName.trim() !== '' &&
    balanceBefore !== '' &&
    balanceAfter !== '' &&
    proofReference.trim() !== '';
  const canSave = complete && !submitting;

  async function save() {
    if (!complete) return;
    setSubmitting(true);
    setRefusal(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/provider-withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          reference: reference.trim(),
          amount: Number(amount),
          destinationName: destinationName.trim(),
          ...(collectingEntityId !== '' ? { collectingEntityId } : {}),
          providerBalanceBefore: Number(balanceBefore),
          providerBalanceAfter: Number(balanceAfter),
          proofReference: proofReference.trim(),
        }),
      });
      if (!res.ok) {
        const refused = await res.json().catch(() => ({}));
        setRefusal(
          typeof refused.error === 'string' && refused.error !== '' ? refused.error : 'Gagal mencatat penarikan.',
        );
        return;
      }
      setSaved(true);
      setReference('');
      setAmount('');
      setBalanceBefore('');
      setBalanceAfter('');
      setProofReference('');
      router.refresh();
    } catch {
      setRefusal('Gagal mencatat penarikan. Periksa koneksi lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2';
  const hintClass = 'mt-1 block text-xs text-gray-400';

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-700">
        Penyedia pembayaran
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass}>
          {providers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-gray-700">
        Referensi penarikan
        <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        <span className={hintClass}>Nomor referensi dari dashboard penyedia. Satu referensi hanya bisa dicatat sekali.</span>
      </label>

      <label className="block text-sm text-gray-700">
        Nominal ditarik (Rp)
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} className={inputClass} />
      </label>

      <label className="block text-sm text-gray-700">
        Nama pemilik rekening tujuan
        <input value={destinationName} onChange={(e) => setDestinationName(e.target.value)} className={inputClass} />
        <span className={hintClass}>Seperti tertulis di penyedia.</span>
      </label>

      <label className="block text-sm text-gray-700">
        Collecting Entity (opsional)
        <select value={collectingEntityId} onChange={(e) => setCollectingEntityId(e.target.value)} className={inputClass}>
          <option value="">Bukan Collecting Entity terdaftar</option>
          {collectingEntities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-gray-700">
          Saldo penyedia sebelum penarikan (Rp)
          <input
            inputMode="numeric"
            value={balanceBefore}
            onChange={(e) => setBalanceBefore(digits(e.target.value))}
            className={inputClass}
          />
        </label>
        <label className="block text-sm text-gray-700">
          Saldo penyedia sesudah penarikan (Rp)
          <input
            inputMode="numeric"
            value={balanceAfter}
            onChange={(e) => setBalanceAfter(digits(e.target.value))}
            className={inputClass}
          />
        </label>
      </div>
      <p className="text-xs text-gray-400">
        Baca kedua saldo di dashboard penyedia tepat sebelum dan sesudah penarikan. Bila selisihnya tidak sama dengan
        nominal, tetap catat apa adanya: selisih itu yang dilaporkan di atas, bukan dikoreksi.
      </p>

      <label className="block text-sm text-gray-700">
        Bukti penarikan
        <input value={proofReference} onChange={(e) => setProofReference(e.target.value)} className={inputClass} />
        <span className={hintClass}>Di mana buktinya disimpan, misalnya tautan tangkapan layar atau nomor mutasi bank.</span>
      </label>

      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Catat penarikan
      </button>

      {saved && (
        <p role="status" className="text-sm text-green-700">
          Penarikan tercatat. Laporan di atas sudah diperbarui.
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
