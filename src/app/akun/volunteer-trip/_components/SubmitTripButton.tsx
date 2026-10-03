'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from './api';

/** Submit a saved Draft or Rejected Trip to a Verifier: PATCH { action: 'submit' }. */
export function SubmitTripButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setPending(true);
    setError('');
    const result = await sendJson(`/api/volunteer-trips/${slug}`, 'PATCH', { action: 'submit' });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-[#C62828]">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => void submit()}
        className="px-4 py-2 bg-[#2E7D32] text-white text-sm font-medium rounded-lg disabled:opacity-50"
      >
        Ajukan ke Verifier
      </button>
    </div>
  );
}
