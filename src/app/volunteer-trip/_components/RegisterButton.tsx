'use client';

import { useState } from 'react';
import { sendJson } from '@/app/akun/volunteer-trip/_components/api';
import { HoldCountdown } from './HoldCountdown';

type Held = { registrationId: string; holdExpiresAt: string; redirectUrl?: string; vaNumber?: string };

/**
 * Creates the Registration (the server holds the seat 30 minutes and gates on
 * the flag, the money switch and the quota) and then shows the countdown and
 * the way to pay. Does not redirect on its own: the Volunteer keeps the
 * countdown in view and opens the payment page themselves. Client component:
 * talks to the API only. QRIS is the one method the provider charges.
 */
export function RegisterButton({ slug, batchId }: { slug: string; batchId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [held, setHeld] = useState<Held | null>(null);

  async function register() {
    if (pending) return;
    setPending(true);
    setError('');
    const result = await sendJson(`/api/volunteer-trips/${slug}/batches/${batchId}/registrations`, 'POST', {
      paymentMethod: 'qris',
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const instructions = (result.data.paymentInstructions ?? {}) as { redirectUrl?: string; vaNumber?: string };
    setHeld({
      registrationId: String(result.data.registrationId),
      holdExpiresAt: String(result.data.holdExpiresAt),
      redirectUrl: instructions.redirectUrl,
      vaNumber: instructions.vaNumber,
    });
  }

  if (held) {
    return (
      <div className="rounded-lg border border-border p-4 space-y-3">
        <p className="text-sm text-text">
          Kursi ditahan selama <HoldCountdown expiresAt={held.holdExpiresAt} />. Selesaikan pembayaran sebelum
          waktu habis; setelahnya kursi dilepas.
        </p>
        {held.vaNumber && (
          <p className="text-sm">
            Nomor Virtual Account: <strong>{held.vaNumber}</strong>
          </p>
        )}
        {held.redirectUrl && (
          <a href={held.redirectUrl} className="inline-block px-4 py-2 rounded-md bg-primary text-white font-medium">
            Bayar sekarang
          </a>
        )}{' '}
        <a href={`/volunteer-trip/registrasi/${held.registrationId}`} className="text-primary font-medium text-sm">
          Lihat status Registrasi
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={register}
        disabled={pending}
        className="w-full py-3 rounded-md bg-primary text-white font-medium disabled:opacity-60"
      >
        {pending ? 'Memproses...' : 'Daftar dan bayar'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
