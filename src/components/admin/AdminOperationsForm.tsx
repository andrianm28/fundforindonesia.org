'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The operational settings (src/lib/operations.ts): donations on/off,
 * maintenance mode with its message, and the donation preset amounts. Posts to POST /api/admin/operations;
 * validation lives only on the server, so the form shows the server's own
 * refusal rather than re-deriving the rules.
 */

type Value = { donationsOpen: boolean; maintenanceOn: boolean; maintenanceMessage: string; donationPresets: string };
type Initial = Omit<Value, 'donationPresets'> & { donationPresets: number[] };

/**
 * "5.000; 10000 25000" -> [5000, 10000, 25000]. A dot counts only as a thousands
 * separator (groups of exactly 3 digits after a 1-3 digit head), so "1.5" is not
 * 15. Anything else goes up as null for the server to refuse.
 */
function parsePresets(text: string): (number | null)[] {
  return text
    .split(/[,;\s]+/)
    .filter((t) => t !== '')
    .map((t) => {
      if (/^\d+$/.test(t)) return Number(t);
      if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
      return null;
    });
}

export function AdminOperationsForm({ initial: initialProp }: { initial: Initial }) {
  const router = useRouter();
  const initial: Value = { ...initialProp, donationPresets: initialProp.donationPresets.join(', ') };
  const [value, setValue] = useState<Value>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Only what this Admin changed goes up, so a stale form never rewrites a
  // setting another Admin changed meanwhile (the server also refuses a save
  // that raced another with a 409).
  const patch: Record<string, unknown> = {};
  if (value.donationsOpen !== initial.donationsOpen) patch.donationsOpen = value.donationsOpen;
  if (value.maintenanceOn !== initial.maintenanceOn) patch.maintenanceOn = value.maintenanceOn;
  if (value.maintenanceMessage !== initial.maintenanceMessage) patch.maintenanceMessage = value.maintenanceMessage;
  if (value.donationPresets !== initial.donationPresets) patch.donationPresets = parsePresets(value.donationPresets);
  const dirty = Object.keys(patch).length > 0;

  function change(patch: Partial<Value>) {
    setValue((v) => ({ ...v, ...patch }));
    setSaved(false);
  }

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
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menyimpan pengaturan.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setRefusal('Gagal menyimpan pengaturan.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Saklar donasi</h2>
        <p className="mb-4 text-sm text-gray-600">
          Dimatikan: donasi, coba bayar ulang, dan pendaftaran Volunteer Trip berbayar ditolak dengan pesan donasi
          ditutup. Pembayaran yang sudah berjalan tetap tercatat lewat webhook.
        </p>
        <label className="flex items-center gap-3 text-sm text-gray-800">
          <input
            type="checkbox"
            aria-label="Terima donasi"
            checked={value.donationsOpen}
            onChange={(e) => change({ donationsOpen: e.target.checked })}
          />
          Terima donasi
        </label>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Mode pemeliharaan</h2>
        <p className="mb-4 text-sm text-gray-600">
          Hidup: semua halaman publik menampilkan banner dan semua tindakan tulis selain Admin ditolak. Panel Admin,
          webhook, health check, dan login tetap berjalan.
        </p>
        <label className="flex items-center gap-3 text-sm text-gray-800">
          <input
            type="checkbox"
            aria-label="Mode pemeliharaan"
            checked={value.maintenanceOn}
            onChange={(e) => change({ maintenanceOn: e.target.checked })}
          />
          Mode pemeliharaan
        </label>
        <label className="mt-4 block text-sm text-gray-700">
          Pesan pemeliharaan
          <textarea
            aria-label="Pesan pemeliharaan"
            rows={3}
            maxLength={500}
            value={value.maintenanceMessage}
            onChange={(e) => change({ maintenanceMessage: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-gray-500">Opsional. Kosong: pesan bawaan yang tampil.</span>
        </label>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Preset nominal donasi</h2>
        <p className="mb-4 text-sm text-gray-600">
          Tombol nominal cepat di halaman donasi: 3 sampai 8 angka rupiah, tidak boleh sama, masing-masing minimal
          Rp1.000. Pisahkan dengan koma.
        </p>
        <input
          type="text"
          aria-label="Preset nominal donasi"
          value={value.donationPresets}
          onChange={(e) => change({ donationPresets: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : 'Simpan'}
        </button>
        {saved && <span className="text-sm text-green-700">Tersimpan.</span>}
        {refusal && (
          <span role="alert" className="text-sm text-red-700">
            {refusal}
          </span>
        )}
      </div>
    </div>
  );
}
