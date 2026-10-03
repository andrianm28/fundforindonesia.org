'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { formatRupiah } from '@/lib/utils/currency';
import Link from 'next/link';
import { WALLET_DISABLED_MESSAGE } from '@/lib/wallet';

export default function AkunPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  // `balanceLoading` starts true, so the effect needs no synchronous setState
  // before the fetch; every setState below runs in the response callbacks.
  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/balance')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch balance');
        return res.json();
      })
      .then((data) => setBalance(data.balance))
      .catch(() => setBalance(0))
      .finally(() => setBalanceLoading(false));
  }, [status]);

  const handleLogout = () => {
    signOut({ callbackUrl: '/login' });
  };

  // Loading state
  if (status === 'loading') {
    return <AccountSkeleton />;
  }

  // Redirecting
  if (status === 'unauthenticated') {
    return null;
  }

  const user = session?.user;

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      {/* Header */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <h1 className="text-white text-lg font-semibold">Akun</h1>
      </div>

      {/* Profile Section */}
      <div className="bg-white mx-4 -mt-2 rounded-xl shadow-sm p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-[#E0E0E0] overflow-hidden flex-shrink-0">
          {user?.image ? (
            <Image
              src={user.image}
              alt={user.name || 'Avatar'}
              width={56}
              height={56}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#0073E6] text-white text-xl font-semibold">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[#212121] font-semibold text-base truncate">
            {user?.name || 'Pengguna'}
          </p>
          <p className="text-[#757575] text-sm truncate">{user?.email}</p>
        </div>
      </div>

      {/* Balance Card. Kantong Donasi top-up is removed (see src/lib/wallet.ts)
          so there is no action here — just the existing
          balance, which is a liability to honour later, not data to hide.
          WALLET_DISABLED_MESSAGE is surfaced below the figure so a user
          holding a balance understands it is temporarily unspendable rather
          than concluding it is gone. */}
      <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm p-4">
        <div>
          <p className="text-[#757575] text-xs">Saldo Kantong Donasi</p>
          {balanceLoading ? (
            <div className="h-6 w-28 bg-[#E0E0E0] rounded animate-pulse mt-1" />
          ) : (
            <>
              <p className="text-[#212121] text-lg font-bold mt-0.5">
                {formatRupiah(balance ?? 0)}
              </p>
              {(balance ?? 0) > 0 && (
                <p className="text-[#757575] text-xs mt-1">{WALLET_DISABLED_MESSAGE}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Settings Links */}
      <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm overflow-hidden">
        <SettingsLink label="Donasi Saya" href="/donasi-saya" />
        <SettingsLink label="Galang Dana Saya" href="/akun/kampanye-saya" />
        <SettingsLink label="Volunteer Trip Saya" href="/akun/volunteer-trip" />
        <SettingsLink label="Keikutsertaan Volunteer Saya" href="/akun/volunteer" />
        <SettingsLink label="Pengaturan" href="/akun/pengaturan" isLast />
      </div>

      {/* Logout Button */}
      <div className="mx-4 mt-4">
        <button
          onClick={handleLogout}
          className="w-full bg-white border border-[#D50000] text-[#D50000] py-3 rounded-xl font-medium text-sm hover:bg-red-50 transition-colors"
        >
          Keluar
        </button>
      </div>
    </div>
  );
}

function SettingsLink({
  label,
  href,
  isLast = false,
}: {
  label: string;
  href: string;
  isLast?: boolean;
}) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(href)}
      className={`w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-[#F5F5F5] transition-colors ${
        !isLast ? 'border-b border-[#E0E0E0]' : ''
      }`}
    >
      <span className="text-[#212121] text-sm">{label}</span>
      <svg
        className="w-4 h-4 text-[#757575]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function AccountSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      {/* Header skeleton */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="h-5 w-16 bg-white/20 rounded" />
      </div>

      {/* Profile skeleton */}
      <div className="bg-white mx-4 -mt-2 rounded-xl shadow-sm p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-[#E0E0E0] animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 bg-[#E0E0E0] rounded animate-pulse" />
          <div className="h-3 w-48 bg-[#E0E0E0] rounded animate-pulse" />
        </div>
      </div>

      {/* Balance skeleton */}
      <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-3 w-28 bg-[#E0E0E0] rounded animate-pulse" />
            <div className="h-6 w-24 bg-[#E0E0E0] rounded animate-pulse" />
          </div>
          <div className="h-9 w-16 bg-[#E0E0E0] rounded-lg animate-pulse" />
        </div>
      </div>

      {/* Settings skeleton */}
      <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm overflow-hidden">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className={`px-4 py-3.5 flex items-center justify-between ${
              i < 3 ? 'border-b border-[#E0E0E0]' : ''
            }`}
          >
            <div className="h-4 w-28 bg-[#E0E0E0] rounded animate-pulse" />
            <div className="h-4 w-4 bg-[#E0E0E0] rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
