'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Outcome = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; claimed: number } | { kind: 'refused' };

/**
 * The page the confirmation link opens (prd-compliance 23). Opening it spends
 * nothing; the token is posted only when the person presses the button, so a
 * mail scanner that fetches the link cannot confirm an address for them.
 */
function Confirm() {
  const token = useSearchParams().get('token');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  async function confirm() {
    setOutcome({ kind: 'working' });
    try {
      const res = await fetch('/api/user/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        setOutcome({ kind: 'refused' });
        return;
      }
      const data = (await res.json()) as { claimed?: number };
      setOutcome({ kind: 'done', claimed: data.claimed ?? 0 });
    } catch {
      setOutcome({ kind: 'refused' });
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] px-4 pt-12">
      <div className="mx-auto max-w-md rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-[#212121]">Konfirmasi Email</h1>
        {!token ? (
          <p className="mt-3 text-sm text-[#757575]">Tautan tidak lengkap. Minta tautan baru dari halaman Donasi Saya.</p>
        ) : outcome.kind === 'done' ? (
          <div className="mt-3 text-sm text-[#212121]">
            <p>Email berhasil dikonfirmasi.</p>
            {outcome.claimed > 0 && <p className="mt-1">{outcome.claimed} donasi tamu Anda kini ada di riwayat.</p>}
            <a href="/donasi-saya" className="mt-4 inline-block font-medium text-[#0073E6] hover:underline">
              Lihat Donasi Saya
            </a>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-[#757575]">Tekan tombol di bawah untuk memastikan email ini milik Anda.</p>
            {outcome.kind === 'refused' && (
              <p role="alert" className="mt-3 text-sm text-[#C62828]">
                Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru dari halaman Donasi Saya.
              </p>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={outcome.kind === 'working'}
              className="mt-4 rounded-lg bg-[#0073E6] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#005BB5] disabled:opacity-60"
            >
              Konfirmasi Email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifikasiEmailPage() {
  return (
    <Suspense fallback={null}>
      <Confirm />
    </Suspense>
  );
}
