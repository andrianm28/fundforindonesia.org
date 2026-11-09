'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The zakat module's switch, nisab and recipient (src/lib/operations.ts,
 * PKS pemenuhan 19, ADR 0028). Posts to POST /api/admin/operations, which is
 * Admin-only; every rule (a recipient with a valid zakat permit and Kind
 * Authorisation, a nisab) is judged there, so this form shows the server's own
 * refusal rather than re-deriving it.
 */

type Zakat = { enabled: boolean; nisabAmount: number; recipientOrganisationId: string | null };
type Organisation = { id: string; name: string };

/** "85.000.000" or "85000000" -> 85000000; anything else goes up as null for the server to refuse. */
function parseRupiah(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) return Number(trimmed.replace(/\./g, ''));
  return null;
}

export function AdminZakatSettingsForm({ initial, organisations }: { initial: Zakat; organisations: Organisation[] }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [nisab, setNisab] = useState(initial.nisabAmount > 0 ? String(initial.nisabAmount) : '');
  const [recipient, setRecipient] = useState(initial.recipientOrganisationId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const initialNisab = initial.nisabAmount > 0 ? String(initial.nisabAmount) : '';
  const patch: Record<string, unknown> = {};
  if (nisab !== initialNisab) patch.zakatNisabAmount = parseRupiah(nisab);
  if (recipient !== (initial.recipientOrganisationId ?? '')) patch.zakatRecipientOrganisationId = recipient === '' ? null : recipient;
  if (enabled !== initial.enabled) patch.zakatEnabled = enabled;
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    setSubmitting(true);
    setRefusal(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menyimpan pengaturan zakat.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setRefusal('Gagal menyimpan pengaturan zakat.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900">Modul zakat</h2>
      <p className="mb-4 text-sm text-gray-600">
        Mati secara bawaan. Selama mati, halaman, menu, peta situs, dan semua API zakat menjawab 404, dan donasi ke
        Campaign zakat ditolak. Jangan dihidupkan sebelum PT Jaya Korpora Prima dan YIEM memenuhi prasyarat legal
        Pasal 12 ayat 2 perjanjian kerja sama: dasar legal atau amil berizin, prosedur, pencatatan, rekening, dan
        penyaluran. Sistem hanya mengizinkan penanda hidup bila lembaga penerima memegang izin pengumpulan dan Kind
        Authorisation zakat yang berlaku saat ini.
      </p>

      <label className="flex items-center gap-3 text-sm text-gray-800">
        <input
          type="checkbox"
          aria-label="Aktifkan modul zakat"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
        />
        Aktifkan modul zakat
      </label>

      <label className="mt-4 block text-sm text-gray-700">
        Nisab tahunan (Rp)
        <input
          type="text"
          aria-label="Nisab tahunan (Rp)"
          inputMode="numeric"
          value={nisab}
          onChange={(e) => {
            setNisab(e.target.value);
            setSaved(false);
          }}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <span className="mt-1 block text-xs text-gray-500">
          Nilai rupiah yang setara 85 gram emas pada hari ini. Perbarui bila harga emas berubah. Zakat penghasilan
          memakai seperduabelasnya, dan tarif tetap 2,5%.
        </span>
      </label>

      <label className="mt-4 block text-sm text-gray-700">
        Lembaga penerima zakat
        <select
          aria-label="Lembaga penerima zakat"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            setSaved(false);
          }}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">(belum dipilih)</option>
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-gray-500">
          Partner Organisation terverifikasi. Zakat hanya diterima lewat Campaign zakat milik lembaga ini.
        </span>
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : 'Simpan pengaturan zakat'}
        </button>
        {saved && <span className="text-sm text-green-700">Tersimpan.</span>}
        {refusal && (
          <span role="alert" className="text-sm text-red-700">
            {refusal}
          </span>
        )}
      </div>
    </section>
  );
}
