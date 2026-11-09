'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { safeCallbackUrl } from '@/lib/safe-callback-url';

type Status = { state: string; enrolled: boolean; pending: boolean; backupCodesRemaining: number };

async function post(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const input =
  'w-full rounded-lg border border-border px-3 py-2 text-base tracking-widest focus:outline-none focus:ring-2 focus:ring-[#0073E6]';
const primary = 'rounded-lg bg-[#0073E6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

/**
 * Keamanan akun: the second factor (TOTP) for Admin and Verifier holders
 * (pks-pemenuhan/03, contract Pasal 8(1)). One page for the three situations
 * a person can be in: not enrolled, enrolled but this session has not entered
 * a code, and enrolled and satisfied. A code is never trusted from this page:
 * the server checks it and hands back a proof that only the jwt callback can
 * turn into a satisfied session.
 */
export default function KeamananPage() {
  const { data: session, status: sessionStatus, update } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/account/mfa');
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') router.replace('/login');
    if (sessionStatus !== 'authenticated') return;
    let cancelled = false;
    fetch('/api/account/mfa')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setStatus(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, router]);

  const next = () => {
    const target = new URLSearchParams(window.location.search).get('callbackUrl');
    router.replace(safeCallbackUrl(target));
  };

  const satisfy = async (proof: unknown) => {
    // The proof is only a claim to be checked: the jwt callback verifies it.
    await update({ mfaProof: proof });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const fail = (r: { status: number; data: Record<string, unknown> }) => {
    setError(typeof r.data.error === 'string' ? r.data.error : 'Terjadi kesalahan.');
    if (r.status === 409 && r.data.code === 'SESSION_STALE') void update();
  };

  const begin = () =>
    run(async () => {
      const r = await post('/api/account/mfa/setup');
      if (!r.ok) return fail(r);
      setSetup({ secret: String(r.data.secret), uri: String(r.data.uri) });
    });

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await post('/api/account/mfa/confirm', { code });
      if (!r.ok) return fail(r);
      setBackupCodes(r.data.backupCodes as string[]);
      setSetup(null);
      setCode('');
      await satisfy(r.data.proof);
      await load();
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await post('/api/account/mfa/verify', { code });
      if (!r.ok) return fail(r);
      await satisfy(r.data.proof);
      next();
    });
  };

  const regenerate = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await post('/api/account/mfa/backup-codes', { code });
      if (!r.ok) return fail(r);
      setBackupCodes(r.data.backupCodes as string[]);
      setCode('');
      await load();
    });
  };

  if (sessionStatus !== 'authenticated' || !status) {
    return <div className="mx-auto max-w-lg px-4 py-10 text-sm text-text-secondary">Memuat...</div>;
  }

  const challenged = session?.user?.mfaState === 'challenge';
  const required = session?.user?.mfaState === 'enroll' || challenged;

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <h1 className="text-xl font-semibold text-ink">Keamanan akun</h1>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {backupCodes && (
        <section aria-labelledby="kode-cadangan" className="space-y-3 rounded-lg border border-border bg-bg p-4">
          <h2 id="kode-cadangan" className="font-semibold text-ink">
            Kode cadangan
          </h2>
          <p className="text-sm text-text-secondary">
            Simpan kode ini di tempat aman. Masing-masing hanya bisa dipakai sekali, dan ini satu-satunya kesempatan
            untuk melihatnya.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" className={primary} onClick={() => (required ? next() : setBackupCodes(null))}>
            Saya sudah menyimpan kode ini
          </button>
        </section>
      )}

      {!backupCodes && challenged && (
        <form onSubmit={verify} className="space-y-3 rounded-lg border border-border bg-bg p-4">
          <h2 className="font-semibold text-ink">Masukkan kode</h2>
          <p className="text-sm text-text-secondary">
            Buka aplikasi authenticator Anda dan masukkan kode 6 digit, atau salah satu kode cadangan.
          </p>
          <label className="block text-sm" htmlFor="kode">
            Kode
          </label>
          <input
            id="kode"
            className={input}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className={primary} disabled={busy || !code.trim()}>
            Verifikasi
          </button>
        </form>
      )}

      {!backupCodes && !status.enrolled && !setup && (
        <section className="space-y-3 rounded-lg border border-border bg-bg p-4">
          <h2 className="font-semibold text-ink">Autentikasi dua faktor</h2>
          <p className="text-sm text-text-secondary">
            {required
              ? 'Akun Anda memegang peran Admin atau Verifier, jadi autentikasi dua faktor wajib sebelum panel bisa dipakai.'
              : 'Tambahkan lapisan keamanan kedua dengan aplikasi authenticator.'}
          </p>
          <button type="button" className={primary} disabled={busy} onClick={begin}>
            Aktifkan
          </button>
        </section>
      )}

      {!backupCodes && setup && (
        <form onSubmit={confirm} className="space-y-3 rounded-lg border border-border bg-bg p-4">
          <h2 className="font-semibold text-ink">Daftarkan aplikasi authenticator</h2>
          <p className="text-sm text-text-secondary">
            Di aplikasi authenticator, tambahkan akun dengan kunci berikut (jenis: berbasis waktu), lalu masukkan kode 6
            digit yang tampil.
          </p>
          <p className="break-all rounded bg-bg-secondary px-3 py-2 font-mono text-sm" data-testid="mfa-secret">
            {setup.secret}
          </p>
          <p className="text-xs text-text-secondary">
            Atau buka tautan ini di perangkat yang sama:{' '}
            <a className="break-all underline" href={setup.uri}>
              {setup.uri}
            </a>
          </p>
          <label className="block text-sm" htmlFor="kode-konfirmasi">
            Kode 6 digit
          </label>
          <input
            id="kode-konfirmasi"
            className={input}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className={primary} disabled={busy || !code.trim()}>
            Konfirmasi
          </button>
        </form>
      )}

      {!backupCodes && status.enrolled && !challenged && (
        <section className="space-y-3 rounded-lg border border-border bg-bg p-4">
          <h2 className="font-semibold text-ink">Autentikasi dua faktor aktif</h2>
          <p className="text-sm text-text-secondary">
            Kode cadangan tersisa: {status.backupCodesRemaining}. Jika perangkat Anda hilang dan kode cadangan habis,
            minta Admin lain mereset autentikasi Anda.
          </p>
          <form onSubmit={regenerate} className="space-y-2">
            <label className="block text-sm" htmlFor="kode-baru">
              Kode dari aplikasi untuk membuat kode cadangan baru
            </label>
            <input
              id="kode-baru"
              className={input}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className={primary} disabled={busy || !code.trim()}>
              Buat kode cadangan baru
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
