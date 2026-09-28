'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AbuseThresholdKind } from '@/generated/prisma/client';

/**
 * One of the four limits an Admin sets (ticket 27; src/lib/abuse-thresholds.ts,
 * CONTEXT.md Verifikasi Tambahan / Penanda Audit / Penanda Donasi): a
 * cumulative Gross, a single Donation, or a count of Active Campaigns. This
 * form edits ONE `kind` and posts it, unchanged, to the existing
 * POST /api/admin/abuse-thresholds route (setAbuseThreshold) -- validation
 * (a positive whole number) lives only on the server, so this form shows the
 * server's own refusal in its own words rather than re-deriving the rule.
 *
 * The title similarity used for Petunjuk Duplikat is a different table with
 * its own route (POST /api/admin/duplicate-similarity) and, per ticket 04's
 * answer, stays a code constant for now -- this form never touches it.
 */

interface AdminAbuseThresholdFormProps {
  kind: AbuseThresholdKind;
  label: string;
  unit: 'rupiah' | 'count';
  currentValue: number;
}

export function AdminAbuseThresholdForm({ kind, label, unit, currentValue }: AdminAbuseThresholdFormProps) {
  const router = useRouter();
  const [value, setValue] = useState(String(currentValue));
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const parsedValue = Number(value);
  const canSave =
    value.trim() !== '' &&
    Number.isInteger(parsedValue) &&
    parsedValue > 0 &&
    parsedValue !== currentValue &&
    !submitting;

  async function save() {
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await fetch('/api/admin/abuse-thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, value: parsedValue }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menyimpan ambang.');
        return;
      }
      router.refresh();
    } catch {
      setRefusal('Gagal menyimpan ambang.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-[200px] text-sm text-gray-700">
        {label}
        <input
          id={kind}
          aria-label={label}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <span className="mt-1 block text-xs text-gray-400">{unit === 'rupiah' ? 'Rupiah' : 'Jumlah Campaign'}</span>
      </label>

      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Simpan
      </button>

      {refusal && (
        <p role="alert" className="w-full text-sm text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}
