'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CodeLoginForm } from '../login/CodeLoginForm';
import { safeCallbackUrl } from '@/lib/safe-callback-url';

interface FormErrors {
  name?: string;
  email?: string;
  whatsapp?: string;
  acceptTerms?: string;
  acceptPrivacy?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [profileType, setProfileType] = useState<'INDIVIDUAL' | 'ORGANISATION'>('INDIVIDUAL');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  // Set once the account exists: the page then asks for the code mailed to it.
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [codeSendFailed, setCodeSendFailed] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  function validateField(field: keyof FormErrors, value: string): string | undefined {
    switch (field) {
      case 'name':
        if (!value.trim()) return 'Nama harus diisi';
        return undefined;
      case 'email':
        if (!value.trim()) return 'Email harus diisi';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Format email tidak valid';
        return undefined;
      default:
        return undefined;
    }
  }

  function handleBlur(field: keyof FormErrors, value: string) {
    const error = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: error }));
  }

  function validateAll(): boolean {
    const newErrors: FormErrors = {
      name: validateField('name', name),
      email: validateField('email', email),
      acceptTerms: acceptTerms ? undefined : 'Anda harus menyetujui Syarat Layanan',
      acceptPrivacy: acceptPrivacy ? undefined : 'Anda harus menyetujui Kebijakan Privasi',
    };
    setErrors(newErrors);
    return !Object.values(newErrors).some(Boolean);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError('');

    if (!validateAll()) return;

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: email.trim(), whatsapp, profileType, acceptTerms, acceptPrivacy }),
      });

      const data = await res.json();

      if (res.status === 409) {
        setServerError('Email sudah terdaftar');
        setIsLoading(false);
        return;
      }

      if (res.status === 400 && data.errors) {
        setErrors(data.errors);
        setIsLoading(false);
        return;
      }

      if (!res.ok) {
        setServerError(data.message || 'Terjadi kesalahan, silakan coba lagi');
        setIsLoading(false);
        return;
      }

      // Signed in by the first code, which also proves the address. A failed
      // send is not fatal: the code step offers "Kirim ulang kode".
      const sent = await fetch('/api/auth/login-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
        .then((r) => r.ok)
        .catch(() => false);
      setCodeSendFailed(!sent);
      setRegisteredEmail(email.trim());
      setIsLoading(false);
    } catch {
      setServerError('Terjadi kesalahan jaringan, silakan coba lagi');
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="bg-primary rounded-t-lg px-6 py-5 text-center">
          <h1 className="text-xl font-bold text-white">Daftar Akun</h1>
          <p className="text-sm text-white/80 mt-1">
            Bergabung dan mulai berbagi kebaikan di Fund for Indonesia
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-b-lg shadow-card px-6 py-6">
          {registeredEmail ? (
            <>
              <p className="mb-4 text-sm text-text">Akun berhasil dibuat. Masukkan kode yang kami kirim ke email Anda untuk masuk.</p>
              <CodeLoginForm
                sendTo={registeredEmail}
                sendFailed={codeSendFailed}
                onSignedIn={() =>
                  router.push(safeCallbackUrl(new URLSearchParams(window.location.search).get('callbackUrl')))
                }
              />
            </>
          ) : (
          <form onSubmit={handleSubmit} noValidate>
            {/* Server Error */}
            {serverError && (
              <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-md">
                <p className="text-sm text-danger">{serverError}</p>
              </div>
            )}

            {/* Name Field */}
            <div className="mb-4">
              <Input
                label="Nama Lengkap"
                name="name"
                type="text"
                placeholder="Masukkan nama lengkap"
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                }}
                onBlur={() => handleBlur('name', name)}
                error={errors.name}
                required
              />
            </div>

            {/* Email Field */}
            <div className="mb-4">
              <Input
                label="Email"
                name="email"
                type="email"
                placeholder="contoh@email.com"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                onBlur={() => handleBlur('email', email)}
                error={errors.email}
                required
              />
            </div>

            {/* WhatsApp Field (optional) */}
            <div className="mb-4">
              <Input
                label="Nomor WhatsApp (opsional)"
                name="whatsapp"
                type="tel"
                placeholder="0812 3456 7890"
                value={whatsapp}
                onChange={(v) => {
                  setWhatsapp(v);
                  if (errors.whatsapp) setErrors((prev) => ({ ...prev, whatsapp: undefined }));
                }}
                error={errors.whatsapp}
              />
            </div>

            {/* Profile type */}
            <fieldset className="mb-4">
              <legend className="text-sm font-medium text-text mb-2">Jenis profil</legend>
              <div className="flex gap-4 text-sm text-text">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="profileType"
                    checked={profileType === 'INDIVIDUAL'}
                    onChange={() => setProfileType('INDIVIDUAL')}
                  />
                  Individu
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="profileType"
                    checked={profileType === 'ORGANISATION'}
                    onChange={() => setProfileType('ORGANISATION')}
                  />
                  Lembaga
                </label>
              </div>
              {profileType === 'ORGANISATION' && (
                <p className="text-xs text-text-secondary mt-1">
                  Lembaga perlu didaftarkan oleh Verifier sebagai Partner Organisation sebelum bisa
                  menggalang dana.
                </p>
              )}
            </fieldset>


            {/* Required consent */}
            <div className="mb-6 space-y-2">
              <label className="flex items-start gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  name="acceptTerms"
                  className="mt-1"
                  checked={acceptTerms}
                  onChange={(e) => {
                    setAcceptTerms(e.target.checked);
                    if (errors.acceptTerms) setErrors((prev) => ({ ...prev, acceptTerms: undefined }));
                  }}
                />
                <span>
                  Saya menyetujui{' '}
                  <Link href="/terms" className="text-primary hover:underline">Syarat Layanan</Link>
                </span>
              </label>
              {errors.acceptTerms && <p className="text-xs text-danger">{errors.acceptTerms}</p>}
              <label className="flex items-start gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  name="acceptPrivacy"
                  className="mt-1"
                  checked={acceptPrivacy}
                  onChange={(e) => {
                    setAcceptPrivacy(e.target.checked);
                    if (errors.acceptPrivacy) setErrors((prev) => ({ ...prev, acceptPrivacy: undefined }));
                  }}
                />
                <span>
                  Saya menyetujui{' '}
                  <Link href="/privacy" className="text-primary hover:underline">Kebijakan Privasi</Link>
                </span>
              </label>
              {errors.acceptPrivacy && <p className="text-xs text-danger">{errors.acceptPrivacy}</p>}
            </div>


            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="full"
              isLoading={isLoading}
              disabled={isLoading}
            >
              Daftar
            </Button>
          </form>
          )}

          {/* Login Link */}
          <p className="text-center text-sm text-text-secondary mt-5">
            Sudah punya akun?{' '}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Masuk di sini
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
