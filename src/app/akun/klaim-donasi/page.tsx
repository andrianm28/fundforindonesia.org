'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Outcome = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; claimed: number } | { kind: 'refused' };

/**
 * The page the claim link opens (prd-audit 08). Opening it spends nothing; the
 * token is posted only when the person presses the button, so a mail scanner
 * that fetches the link cannot spend it. The link works only while signed in
 * as the account that asked for it.
 */
function Claim() {
  const token = useSearchParams().get('token');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  async function claim() {
    setOutcome({ kind: 'working' });
    try {
      const res = await fetch('/api/user/guest-claim/confirm', {
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
    <div className="min-h-screen bg-bg-secondary px-4 pt-12">
      <div className="mx-auto max-w-md rounded-xl bg-white p-6 shadow-xs">
        <h1 className="text-lg font-semibold text-text">Tautkan Donasi Tamu</h1>
        {!token ? (
          <p className="mt-3 text-sm text-text-secondary">Tautan tidak lengkap. Minta tautan baru dari halaman Donasi Saya.</p>
        ) : outcome.kind === 'done' ? (
          <div className="mt-3 text-sm text-text">
            {outcome.claimed > 0 ? (
              <p>{outcome.claimed} donasi tamu Anda kini ada di riwayat.</p>
            ) : (
              <p>Tidak ada donasi tamu baru yang cocok dengan email akun ini.</p>
            )}
            <a href="/donasi-saya" className="mt-4 inline-block font-medium text-[#0073E6] hover:underline">
              Lihat Donasi Saya
            </a>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-text-secondary">
              Tekan tombol di bawah untuk menautkan donasi yang pernah Anda berikan sebagai tamu dengan email akun ini.
              Anda harus masuk sebagai akun yang meminta tautan.
            </p>
            {outcome.kind === 'refused' && (
              <p role="alert" className="mt-3 text-sm text-[#C62828]">
                Tautan tidak valid, sudah dipakai, atau sudah kedaluwarsa. Pastikan Anda masuk ke akun yang meminta tautan,
                atau minta tautan baru dari halaman Donasi Saya.
              </p>
            )}
            <button
              type="button"
              onClick={claim}
              disabled={outcome.kind === 'working'}
              className="mt-4 rounded-lg bg-[#0073E6] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#005BB5] disabled:opacity-60"
            >
              Tautkan Donasi
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function KlaimDonasiPage() {
  return (
    <Suspense fallback={null}>
      <Claim />
    </Suspense>
  );
}
