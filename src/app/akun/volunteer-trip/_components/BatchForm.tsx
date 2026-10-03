'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fromWibDate } from '@/lib/volunteer/batch-dates';
import { sendJson } from './api';

export type BatchFormValues = {
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  maxQuota: number | '';
  minQuota: number | '';
};

const EMPTY: BatchFormValues = { startDate: '', endDate: '', registrationDeadline: '', maxQuota: '', minQuota: '' };

/**
 * Add a Batch to a Trip (POST /api/volunteer-trips/[slug]/batches), or change
 * an OPEN one (PATCH .../batches/[id]). Dates are WIB calendar dates. Whether
 * the dates and quotas agree, and whether the Batch is still OPEN, are the
 * server's to judge; its refusal text is shown as it comes. Once a Batch has
 * seats taken (`seatsUsed` > 0) its dates are shown read-only and not sent:
 * the Volunteers' tiered Refund is counted from them (ticket 48), and the
 * server refuses a change anyway. Client component:
 * talks to the API only.
 */
export function BatchForm({
  slug,
  batchId,
  initial,
  seatsUsed,
  onDone,
}: {
  slug: string;
  batchId?: string;
  initial?: BatchFormValues;
  /** Seats held or confirmed: above zero the dates are frozen and maxQuota cannot go below it. */
  seatsUsed: number;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<BatchFormValues>(initial ?? EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const id = batchId ?? 'new';
  const frozen = Boolean(batchId) && seatsUsed > 0;

  const set = <K extends keyof BatchFormValues>(key: K, value: BatchFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function save() {
    setPending(true);
    setError('');
    const dates = frozen
      ? {}
      : {
          startDate: fromWibDate(values.startDate, 'start'),
          endDate: fromWibDate(values.endDate, 'end'),
          registrationDeadline: fromWibDate(values.registrationDeadline, 'end'),
        };
    const body = {
      ...dates,
      maxQuota: Number(values.maxQuota),
      minQuota: Number(values.minQuota),
    };
    const result = batchId
      ? await sendJson(`/api/volunteer-trips/${slug}/batches/${batchId}`, 'PATCH', body)
      : await sendJson(`/api/volunteer-trips/${slug}/batches`, 'POST', body);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (!batchId) setValues(EMPTY);
    onDone?.();
    router.refresh();
  }

  const field = 'w-full rounded-lg border border-border p-2 text-sm';
  const label = 'block text-xs font-medium text-text mb-1';

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {error && (
        <p role="alert" className="text-sm text-[#C62828]">
          {error}
        </p>
      )}
      {frozen && (
        <p className="text-sm text-text-secondary">
          Tanggal Batch dikunci karena sudah ada {seatsUsed} Volunteer yang mendaftar atau membayar: refund mereka
          dihitung dari tanggal ini. Kuota maksimum tidak bisa di bawah {seatsUsed}, dan kuota minimum tidak bisa
          dinaikkan di atas jumlah Registration yang sudah CONFIRMED. Bila Batch tidak bisa berjalan, batalkan Batch.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`start-${id}`} className={label}>
            Tanggal mulai
          </label>
          <input
            id={`start-${id}`}
            type="date"
            className={frozen ? `${field} bg-bg-secondary text-text-secondary` : field}
            value={values.startDate}
            required
            readOnly={frozen}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`end-${id}`} className={label}>
            Tanggal selesai
          </label>
          <input
            id={`end-${id}`}
            type="date"
            className={field}
            value={values.endDate}
            required
            readOnly={frozen}
            onChange={(e) => set('endDate', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`deadline-${id}`} className={label}>
            Tenggat pendaftaran
          </label>
          <input
            id={`deadline-${id}`}
            type="date"
            className={field}
            value={values.registrationDeadline}
            required
            readOnly={frozen}
            onChange={(e) => set('registrationDeadline', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`max-${id}`} className={label}>
            Kuota maksimum
          </label>
          <input
            id={`max-${id}`}
            type="number"
            min={Math.max(1, frozen ? seatsUsed : 1)}
            className={field}
            value={values.maxQuota}
            required
            onChange={(e) => set('maxQuota', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor={`min-${id}`} className={label}>
            Kuota minimum
          </label>
          <input
            id={`min-${id}`}
            type="number"
            min={1}
            className={field}
            value={values.minQuota}
            required
            onChange={(e) => set('minQuota', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-[#0073E6] text-white text-sm font-medium rounded-lg disabled:opacity-50"
      >
        {batchId ? 'Simpan Batch' : 'Tambah Batch'}
      </button>
    </form>
  );
}
