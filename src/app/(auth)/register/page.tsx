'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      case 'password':
        if (!value) return 'Password harus diisi';
        if (value.length < 8) return 'Password minimal 8 karakter';
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
      password: validateField('password', password),
    };
    setErrors(newErrors);
    return !newErrors.name && !newErrors.email && !newErrors.password;
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
        body: JSON.stringify({ name, email, password }),
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

      // Success - redirect to login with success message
      router.push('/login?registered=true');
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
            Bergabung dengan jutaan orang baik di Fund for Indonesia
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-b-lg shadow-card px-6 py-6">
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

            {/* Password Field */}
            <div className="mb-6">
              <Input
                label="Password"
                name="password"
                type="password"
                placeholder="Minimal 8 karakter"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                }}
                onBlur={() => handleBlur('password', password)}
                error={errors.password}
                helperText="Minimal 8 karakter"
                required
              />
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
