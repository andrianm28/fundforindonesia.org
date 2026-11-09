'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { clearConsentCache } from '@/components/layout/ConsentGate';

/**
 * Persetujuan pertama untuk akun yang dibuat lewat Google (PKS Pasal 3.1):
 * dua centang wajib yang pada pendaftaran biasa ada di formulir daftar. Dikirim
 * ke POST /api/user/consent, yang mencatat versi dokumen dan waktunya.
 */
export default function ConsentPage() {
  const router = useRouter();
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!acceptTerms || !acceptPrivacy) {
      setError('Anda harus menyetujui Syarat Layanan dan Kebijakan Privasi untuk melanjutkan');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/user/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptTerms, acceptPrivacy }),
      });
      if (!res.ok) {
        setError('Gagal menyimpan persetujuan. Coba lagi.');
        setLoading(false);
        return;
      }
      clearConsentCache();
      router.replace('/');
    } catch {
      setError('Terjadi kesalahan jaringan, silakan coba lagi');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-secondary px-4 py-8">
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-white rounded-lg shadow-card px-6 py-6 space-y-4">
        <h1 className="text-lg font-bold text-text">Satu langkah lagi</h1>
        <p className="text-sm text-text-secondary">
          Sebelum memakai akun Anda, setujui dokumen berikut.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="mt-1" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
          <span>
            Saya menyetujui{' '}
            <Link href="/terms" className="text-primary hover:underline">Syarat Layanan</Link>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="mt-1" checked={acceptPrivacy} onChange={(e) => setAcceptPrivacy(e.target.checked)} />
          <span>
            Saya menyetujui{' '}
            <Link href="/privacy" className="text-primary hover:underline">Kebijakan Privasi</Link>
          </span>
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-white text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50"
        >
          {loading ? 'Menyimpan...' : 'Lanjutkan'}
        </button>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full text-sm text-text-secondary hover:underline"
        >
          Keluar
        </button>
      </form>
    </div>
  );
}
