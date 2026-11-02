'use client';

import { useEffect, useState, FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

/** Seconds before another code may be asked for; matches LOGIN_CODE_COOLDOWN_MS. */
export const RESEND_SECONDS = 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT_CLASS =
  'w-full px-4 py-2.5 border border-border rounded-md text-text placeholder:text-text-secondary/60 focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

type Props = {
  /** Where to go after signing in; read at the moment of success. */
  onSignedIn: () => void;
  /**
   * An address a code was just mailed to elsewhere (the register page): the
   * form opens at the code step with the resend cooldown running.
   */
  sendTo?: string;
};

/**
 * Sign-in with a code mailed to the address (login OTP). Two steps on one
 * card: the address, then the 6-digit code. The request endpoint answers the
 * same for every address, so this never says whether an account exists.
 */
export function CodeLoginForm({ onSignedIn, sendTo }: Props) {
  const [step, setStep] = useState<'email' | 'code'>(sendTo ? 'code' : 'email');
  const [email, setEmail] = useState(sendTo ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(sendTo ? 'Kode masuk sudah kami kirim.' : '');
  const [isLoading, setIsLoading] = useState(false);
  const [resendIn, setResendIn] = useState(sendTo ? RESEND_SECONDS : 0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const requestCode = async (address: string = email): Promise<boolean> => {
    const response = await fetch('/api/auth/login-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address.trim() }),
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      setError(body.message || 'Terjadi kesalahan. Silakan coba lagi.');
      return false;
    }
    setNotice(body.message || 'Kode masuk sudah kami kirim.');
    setResendIn(RESEND_SECONDS);
    return true;
  };

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Email harus diisi');
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('Format email tidak valid');
      return;
    }
    setIsLoading(true);
    try {
      if (await requestCode(email)) setStep('code');
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setIsLoading(true);
    try {
      await requestCode(email);
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const digits = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(digits)) {
      setError('Masukkan 6 digit kode dari email');
      return;
    }
    setIsLoading(true);
    try {
      const result = await signIn('email-otp', { email: email.trim(), code: digits, redirect: false });
      if (result?.ok && !result.error) {
        onSignedIn();
      } else if (result?.error && /Terlalu banyak/.test(result.error)) {
        setError('Terlalu banyak percobaan masuk. Coba lagi nanti.');
      } else {
        setError('Kode salah atau sudah tidak berlaku');
      }
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-danger text-sm" role="alert">
          {error}
        </div>
      )}

      {step === 'email' ? (
        <form onSubmit={handleEmailSubmit} noValidate>
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
              className={INPUT_CLASS}
              autoComplete="email"
            />
            <p className="mt-2 text-xs text-text-secondary">Kami akan mengirim kode masuk 6 digit ke email ini.</p>
          </div>
          <Button type="submit" variant="primary" size="full" isLoading={isLoading}>
            Kirim kode
          </Button>
        </form>
      ) : (
        <form onSubmit={handleCodeSubmit} noValidate>
          {notice && (
            <p className="mb-4 p-3 rounded-md bg-blue-50 border border-blue-200 text-sm text-text" role="status">
              {notice} Kode dikirim ke <strong>{email.trim()}</strong>.
            </p>
          )}
          <div className="mb-6">
            <label htmlFor="code" className="block text-sm font-medium text-text mb-1.5">
              Kode masuk
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError('');
              }}
              placeholder="6 digit kode"
              className={`${INPUT_CLASS} tracking-[0.4em] text-center text-lg`}
            />
            <div className="mt-2 flex justify-between text-sm">
              <button
                type="button"
                className="text-primary font-medium hover:underline"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError('');
                  setNotice('');
                }}
              >
                Ganti email
              </button>
              <button
                type="button"
                className="text-primary font-medium hover:underline disabled:text-text-secondary disabled:no-underline"
                disabled={resendIn > 0 || isLoading}
                onClick={handleResend}
              >
                {resendIn > 0 ? `Kirim ulang (${resendIn} dtk)` : 'Kirim ulang kode'}
              </button>
            </div>
          </div>
          <Button type="submit" variant="primary" size="full" isLoading={isLoading}>
            Masuk
          </Button>
        </form>
      )}
    </>
  );
}
