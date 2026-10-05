'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

const INPUT_CLASS =
  'w-full px-4 py-2.5 border border-border rounded-md text-text placeholder:text-text-secondary/60 focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors';

/**
 * The page the reset link opens (rilis-1 93). Opening it spends nothing: the
 * token is posted only when the form is submitted, so a mail scanner that
 * fetches the link cannot use it. The server sends `Referrer-Policy:
 * no-referrer` for this path (next.config.mjs), so the token does not leave in
 * a Referer header.
 */
function ResetForm() {
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [tokenRefused, setTokenRefused] = useState(false);
  const [done, setDone] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setTokenRefused(false);

    // The same bar the server holds (src/lib/password-schema.ts); the server
    // is the authority and answers with its own message if this drifts.
    if (password.length < 8) {
      setError('Password minimal 8 karakter');
      return;
    }
    if (password !== confirm) {
      setError('Konfirmasi password tidak cocok');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { message?: string; errors?: { password?: string } };
      if (res.status === 400 && !data.errors) {
        setTokenRefused(true);
        setError('Tautan tidak valid atau sudah kedaluwarsa.');
        return;
      }
      setError(data.errors?.password || data.message || 'Terjadi kesalahan. Silakan coba lagi.');
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  const newLink = (
    <Link href="/lupa-password" className="text-primary font-medium hover:underline">
      Minta tautan baru
    </Link>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-lg shadow-card p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text">Buat Password Baru</h1>
        </div>

        {!token ? (
          <p className="text-sm text-text-secondary">
            Tautan tidak lengkap. {newLink} dari halaman Lupa Password.
          </p>
        ) : done ? (
          <div className="text-sm text-text" role="status">
            <p>Password berhasil diubah. Silakan masuk dengan password baru.</p>
            <Link href="/login" className="mt-4 inline-block text-primary font-medium hover:underline">
              Masuk
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-danger text-sm" role="alert">
                {error}
                {tokenRefused && <> {newLink}.</>}
              </div>
            )}
            <form onSubmit={handleSubmit} noValidate>
              <div className="mb-4">
                <label htmlFor="password" className="block text-sm font-medium text-text mb-1.5">
                  Password baru
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Minimal 8 karakter"
                  className={INPUT_CLASS}
                  autoComplete="new-password"
                />
              </div>
              <div className="mb-6">
                <label htmlFor="confirm" className="block text-sm font-medium text-text mb-1.5">
                  Konfirmasi password
                </label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Ulangi password baru"
                  className={INPUT_CLASS}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" variant="primary" size="full" isLoading={isLoading}>
                Simpan password
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
