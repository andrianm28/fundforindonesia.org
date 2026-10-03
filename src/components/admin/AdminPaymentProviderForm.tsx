'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PaymentProviderName } from '@/lib/payments/provider-names';
import type { PaymentMethod } from '@/lib/payments/types';

/**
 * Switches one Payment Provider on, with the methods an Admin picks for it
 * (prd-compliance 39). Posts `{ provider, methods }` to the existing
 * POST /api/admin/payment-providers route and shows the server's own refusal in
 * its own words: which providers exist, which are configured and which methods
 * each supports are all decided there, never re-derived here. No field takes a
 * credential -- those are environment variables.
 */

interface AdminPaymentProviderFormProps {
  provider: PaymentProviderName;
  /** Methods this provider supports. */
  methods: { value: PaymentMethod; label: string }[];
  /** Methods currently enabled when this provider is the one in force. */
  enabled: PaymentMethod[];
  active: boolean;
  /** Why this provider cannot be switched on here, or null. */
  unavailableReason: string | null;
}

export function AdminPaymentProviderForm({
  provider,
  methods,
  enabled,
  active,
  unavailableReason,
}: AdminPaymentProviderFormProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<PaymentMethod[]>(enabled.length > 0 ? enabled : methods.map((m) => m.value));
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canSave = unavailableReason === null && selected.length > 0 && !submitting;

  function toggle(value: PaymentMethod) {
    setSaved(false);
    setSelected((current) => (current.includes(value) ? current.filter((m) => m !== value) : [...current, value]));
  }

  async function save() {
    setSubmitting(true);
    setRefusal(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/payment-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, methods: selected }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menyimpan pilihan.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setRefusal('Gagal menyimpan pilihan.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">{provider}</h2>
        {active && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Aktif</span>
        )}
      </div>

      {unavailableReason ? (
        <p className="text-sm text-gray-500">{unavailableReason}</p>
      ) : (
        <fieldset className="space-y-1">
          <legend className="text-xs text-gray-500">Metode yang ditawarkan ke Donor</legend>
          {methods.map((m) => (
            <label key={m.value} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={selected.includes(m.value)}
                onChange={() => toggle(m.value)}
                aria-label={`${provider} ${m.label}`}
              />
              {m.label}
            </label>
          ))}
        </fieldset>
      )}

      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {active ? 'Simpan metode' : 'Aktifkan'}
      </button>

      {saved && (
        <p role="status" className="text-sm text-green-700">
          Tersimpan. {provider} sekarang menerima Payment baru.
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
