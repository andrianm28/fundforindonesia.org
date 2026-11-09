'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ZAKAT_ASNAF, ZAKAT_ASNAF_LABEL } from '@/lib/zakat-distributions';
import { formatRupiah } from '@/lib/utils/currency';

/**
 * Records that the zakat institution distributed zakat to mustahik (PKS
 * pemenuhan 19, ADR 0028). Posts to POST /api/admin/zakat/distributions. A
 * record only: it moves no money. Every rule is judged on the server, so the
 * form shows the server's own refusal.
 */

/** "500.000" or "500000" -> number; anything else goes up as null for the server to refuse. */
function parseRupiah(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) return Number(trimmed.replace(/\./g, ''));
  return null;
}

const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

export function AdminZakatDistributionForm({ remaining }: { remaining: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [asnaf, setAsnaf] = useState<string>(ZAKAT_ASNAF[0]);
  const [distributedAt, setDistributedAt] = useState('');
  const [summary, setSummary] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSubmitting(true);
    setRefusal(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/zakat/distributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseRupiah(amount),
          asnaf,
          distributedAt,
          recipientSummary: summary,
          ...(note.trim() !== '' && { note }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal mencatat penyaluran.');
        return;
      }
      setSaved(true);
      setAmount('');
      setSummary('');
      setNote('');
      router.refresh();
    } catch {
      setRefusal('Gagal mencatat penyaluran.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900">Catat penyaluran zakat</h2>
      <p className="mb-4 text-sm text-gray-600">
        Mencatat bahwa lembaga penerima sudah menyalurkan zakat kepada mustahik. Pencatatan ini tidak memindahkan uang
        dan tidak membuat Payout; pembayaran ke lembaga tetap lewat Payout seperti biasa. Sisa yang bisa dicatat:{' '}
        <strong>{formatRupiah(Math.max(0, remaining))}</strong>.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-gray-700">
          Nominal (Rp)
          <input aria-label="Nominal (Rp)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm text-gray-700">
          Golongan penerima (asnaf)
          <select aria-label="Golongan penerima (asnaf)" value={asnaf} onChange={(e) => setAsnaf(e.target.value)} className={inputClass}>
            {ZAKAT_ASNAF.map((a) => (
              <option key={a} value={a}>
                {ZAKAT_ASNAF_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-gray-700">
          Tanggal penyaluran
          <input aria-label="Tanggal penyaluran" type="date" value={distributedAt} onChange={(e) => setDistributedAt(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm text-gray-700 sm:col-span-2">
          Ringkasan penerima
          <input
            aria-label="Ringkasan penerima"
            maxLength={300}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-gray-500">
            Contoh: 25 keluarga di Desa Contoh. Jangan tulis nama atau data pribadi perorangan.
          </span>
        </label>
        <label className="block text-sm text-gray-700 sm:col-span-2">
          Catatan (opsional)
          <input aria-label="Catatan" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : 'Catat penyaluran'}
        </button>
        {saved && <span className="text-sm text-green-700">Tercatat.</span>}
        {refusal && (
          <span role="alert" className="text-sm text-red-700">
            {refusal}
          </span>
        )}
      </div>
    </section>
  );
}
