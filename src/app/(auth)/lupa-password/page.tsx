'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { RESET_REQUESTED_MESSAGE } from '@/lib/password-reset-copy';

/**
 * Asks for a password reset link (rilis-1 93). The confirmation is the same
 * whatever the server knows about the address: the endpoint does not say, and
 * neither does this page. The text is shared with the endpoint
 * (src/lib/password-reset-copy.ts) so there is one copy of it.
 */
export default function LupaPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmed = email.trim();
    if (!trimmed) {
      setError('Email harus diisi');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Format email tidak valid');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        // 429 and 503 carry a message worth showing; anything else is generic.
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setError(data.message || 'Terjadi kesalahan. Silakan coba lagi.');
        return;
      }
      setSent(true);
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-lg shadow-card p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text">Lupa Password</h1>
          <p className="text-text-secondary mt-2 text-sm">
            Masukkan email akun kamu. Kami kirim tautan untuk membuat password baru.
          </p>
        </div>

        {sent ? (
          <div className="p-3 rounded-md bg-green-50 border border-green-200 text-sm text-text" role="status">
            {RESET_REQUESTED_MESSAGE}
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-danger text-sm" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} noValidate>
              <div className="mb-6">
                <label htmlFor="email" className="block text-sm font-medium text-text mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Masukkan email kamu"
                  className="w-full px-4 py-2.5 border border-border rounded-md text-text placeholder:text-text-secondary/60 focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  autoComplete="email"
                />
              </div>
              <Button type="submit" variant="primary" size="full" isLoading={isLoading}>
                Kirim tautan
              </Button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-sm text-text-secondary">
          <Link href="/login" className="text-primary font-medium hover:underline">
            Kembali ke halaman masuk
          </Link>
        </p>
      </div>
    </div>
  );
}
