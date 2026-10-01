'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from './api';

export type TripFormValues = {
  title: string;
  description: string;
  story: string;
  coverImage: string;
  destination: string;
  itinerary: string;
  tripFeeAmount: number | '';
};

const EMPTY: TripFormValues = {
  title: '',
  description: '',
  story: '',
  coverImage: '',
  destination: '',
  itinerary: '',
  tripFeeAmount: '',
};

/**
 * Create a Draft Volunteer Trip (POST /api/volunteer-trips), or edit a Draft
 * or Rejected one (PATCH /api/volunteer-trips/[slug]); `submit` sends the
 * form's fields together with the submit in one call. Whether the Trip may be
 * edited or submitted is the server's judgement; its refusal text is shown as
 * it comes. Client component: talks to the API only.
 */
export function TripForm({ slug, initial }: { slug?: string; initial?: TripFormValues }) {
  const router = useRouter();
  const [values, setValues] = useState<TripFormValues>(initial ?? EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function uploadCover(file: File) {
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/upload', { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setError(body.error ?? 'Gagal mengunggah sampul.');
        return;
      }
      set('coverImage', body.url);
    } catch {
      setError('Gagal mengunggah sampul.');
    }
  }

  async function save(submit: boolean) {
    setPending(true);
    setError('');
    const payload = { ...values, tripFeeAmount: Number(values.tripFeeAmount) };
    const result = slug
      ? await sendJson(`/api/volunteer-trips/${slug}`, 'PATCH', submit ? { ...payload, action: 'submit' } : payload)
      : await sendJson('/api/volunteer-trips', 'POST', payload);
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    if (slug) {
      router.refresh();
      setPending(false);
      return;
    }
    const created = result.data as { slug?: string };
    router.push(created.slug ? `/akun/volunteer-trip/${created.slug}` : '/akun/volunteer-trip');
  }

  const field = 'w-full rounded-lg border border-[#E0E0E0] p-2 text-sm';
  const label = 'block text-sm font-medium text-[#212121] mb-1';

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      {error && (
        <p role="alert" className="text-sm text-[#C62828]">
          {error}
        </p>
      )}
      <div>
        <label htmlFor="trip-title" className={label}>
          Judul
        </label>
        <input
          id="trip-title"
          className={field}
          value={values.title}
          maxLength={200}
          required
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="trip-destination" className={label}>
          Destinasi
        </label>
        <input
          id="trip-destination"
          className={field}
          value={values.destination}
          required
          onChange={(e) => set('destination', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="trip-description" className={label}>
          Deskripsi
        </label>
        <textarea
          id="trip-description"
          className={field}
          rows={3}
          value={values.description}
          required
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="trip-story" className={label}>
          Cerita
        </label>
        <textarea
          id="trip-story"
          className={field}
          rows={5}
          value={values.story}
          required
          onChange={(e) => set('story', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="trip-itinerary" className={label}>
          Itinerary
        </label>
        <textarea
          id="trip-itinerary"
          className={field}
          rows={5}
          value={values.itinerary}
          required
          onChange={(e) => set('itinerary', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="trip-fee" className={label}>
          Trip Fee (Rp)
        </label>
        <input
          id="trip-fee"
          type="number"
          min={1}
          className={field}
          value={values.tripFeeAmount}
          required
          onChange={(e) => set('tripFeeAmount', e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>
      <div>
        <label htmlFor="trip-cover" className={label}>
          Sampul
        </label>
        <input
          id="trip-cover"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadCover(file);
          }}
        />
        {values.coverImage && <p className="text-xs text-[#757575] mt-1 break-all">Sampul terpasang: {values.coverImage}</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || values.coverImage === ''}
          className="px-4 py-2 bg-[#0073E6] text-white text-sm font-medium rounded-lg disabled:opacity-50"
        >
          {slug ? 'Simpan perubahan' : 'Simpan Draft'}
        </button>
        {slug && (
          <button
            type="button"
            disabled={pending || values.coverImage === ''}
            onClick={() => void save(true)}
            className="px-4 py-2 bg-[#2E7D32] text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            Simpan dan ajukan ke Verifier
          </button>
        )}
      </div>
    </form>
  );
}
