'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { formatRupiah } from '@/lib/utils/currency';
import { VerificationDialog } from '@/components/dialogs/VerificationDialog';
import { WALLET_DISABLED_MESSAGE } from '@/lib/wallet';

export default function AkunPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [verifyOpen, setVerifyOpen] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchBalance();
    }
  }, [status]);

  const fetchBalance = () => {
    setBalanceLoading(true);
    fetch('/api/balance')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch balance');
        return res.json();
      })
      .then((data) => setBalance(data.balance))
      .catch(() => setBalance(0))
      .finally(() => setBalanceLoading(false));
  };

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
          {user?.isVerified && (
            <span className="inline-flex items-center gap-1 text-xs text-[#00C853] mt-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Identitas terverifikasi
            </span>
          )}
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

      {/* Verification CTA */}
      {user?.isVerified ? (
        <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[#212121] text-sm font-medium">Verifikasi Identitas</p>
              <p className="text-[#757575] text-xs mt-0.5">
                Identitas Anda telah diverifikasi
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-[#00C853] bg-[#E8F5E9] px-3 py-1.5 rounded-lg font-medium">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              {user.verificationType === 'ktp'
                ? 'Terverifikasi via KTP'
                : user.verificationType === 'organization'
                ? 'Terverifikasi via Organisasi'
                : 'Terverifikasi'}
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[#212121] text-sm font-medium">Verifikasi Identitas</p>
              <p className="text-[#757575] text-xs mt-0.5">
                Verifikasi untuk membuat galang dana
              </p>
            </div>
            <button
              onClick={() => setVerifyOpen(true)}
              className="border border-[#0073E6] text-[#0073E6] text-sm px-4 py-2 rounded-lg font-medium hover:bg-blue-50 transition-colors"
            >
              Verifikasi
            </button>
          </div>
        </div>
      )}

      {/* Settings Links */}
      <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm overflow-hidden">
        <SettingsLink label="Donasi Saya" href="/donasi-saya" />
        <SettingsLink label="Galang Dana Saya" href="/akun/kampanye-saya" />
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

      {/* Verification Dialog */}
      <VerificationDialog
        isOpen={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        onSuccess={() => update()}
      />
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
