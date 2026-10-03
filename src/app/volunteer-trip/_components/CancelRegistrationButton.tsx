'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/app/akun/volunteer-trip/_components/api';
import { formatRupiah } from '@/lib/utils/currency';

/**
 * A Volunteer cancels their own Registration. The button first shows what
 * they will get back (`refundAmount`, the tiered amount as of the page load;
 * the server recomputes it at the moment of cancelling and is the one that
 * counts), and only a second click cancels. Client component: talks to the API
 * only, and is never behind the registration flag.
 */
export function CancelRegistrationButton({
  registrationId,
  paid,
  refundAmount,
}: {
  registrationId: string;
  paid: boolean;
  refundAmount: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function cancel() {
    if (pending) return;
    setPending(true);
    setError('');
    const result = await sendJson(`/api/registrations/${registrationId}`, 'PATCH', {});
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="px-4 py-2 rounded-md border border-danger text-danger font-medium"
      >
        Batalkan Registrasi
      </button>
    );
  }

  const consequence = !paid
    ? 'Belum ada pembayaran yang tercatat, jadi tidak ada Refund. Kursi Anda dilepas.'
    : refundAmount > 0
      ? `Anda akan mendapat Refund ${formatRupiah(refundAmount)} berdasarkan waktu pembatalan saat ini. Jumlah dihitung ulang saat Anda mengonfirmasi.`
      : 'Pembatalan sekarang berada dalam jendela tanpa Refund: tidak ada Refund Trip Fee.';

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm text-text">{consequence}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="px-4 py-2 rounded-md bg-danger text-white font-medium disabled:opacity-60"
        >
          Ya, batalkan
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="px-4 py-2 text-sm">
          Kembali
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
