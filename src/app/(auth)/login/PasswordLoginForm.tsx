'use client';

import { useState, FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

/**
 * The password sign-in, kept as a fallback while sign-in by mailed code
 * (CodeLoginForm) becomes the default.
 */
export function PasswordLoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const isLocked = failedAttempts >= 5;

  const validateForm = (): boolean => {
    if (!email.trim()) {
      setError('Email harus diisi');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Format email tidak valid');
      return false;
    }
    if (!password) {
      setError('Password harus diisi');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (isLocked) {
      setError('Terlalu banyak percobaan. Coba lagi nanti.');
      return;
    }

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        const newAttempts = failedAttempts + 1;
        setFailedAttempts(newAttempts);

        if (newAttempts >= 5) {
          setError('Terlalu banyak percobaan. Coba lagi nanti.');
        } else {
          setError('Email atau password salah');
        }
      } else if (result?.ok) {
        onSignedIn();
      }
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
          {/* Error Alert */}
          {error && (
            <div
              className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-danger text-sm"
              role="alert"
            >
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} noValidate>
            {/* Email Field */}
            <div className="mb-4">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-text mb-1.5"
              >
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
                disabled={isLocked}
                className="w-full px-4 py-2.5 border border-border rounded-md text-text placeholder:text-text-secondary/60 focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                autoComplete="email"
              />
            </div>

            {/* Password Field */}
            <div className="mb-6">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-text mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder="Masukkan password"
                disabled={isLocked}
                className="w-full px-4 py-2.5 border border-border rounded-md text-text placeholder:text-text-secondary/60 focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                autoComplete="current-password"
              />
              <div className="mt-2 text-right">
                <Link
                  href="/lupa-password"
                  className="text-sm text-primary font-medium hover:underline"
                >
                  Lupa password?
                </Link>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="full"
              isLoading={isLoading}
              disabled={isLocked}
            >
              Masuk
            </Button>
          </form>
    </>
  );
}
