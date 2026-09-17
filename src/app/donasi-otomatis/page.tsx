'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatRupiah } from '@/lib/utils/currency';

interface AutoDonationSettings {
  id: string;
  amount: number;
  category: string;
  schedule: string;
  time: string;
  isActive: boolean;
}

const CATEGORIES = [
  { slug: 'bencana-alam', name: 'Bencana Alam', icon: '🌊' },
  { slug: 'balita-anak-sakit', name: 'Balita & Anak Sakit', icon: '👶' },
  { slug: 'bantuan-medis', name: 'Bantuan Medis & Kesehatan', icon: '🏥' },
  { slug: 'pendidikan', name: 'Pendidikan', icon: '📚' },
  { slug: 'kemanusiaan', name: 'Kemanusiaan', icon: '🤝' },
  { slug: 'rumah-ibadah', name: 'Rumah Ibadah', icon: '🕌' },
  { slug: 'infrastruktur', name: 'Infrastruktur', icon: '🏗️' },
  { slug: 'lingkungan', name: 'Lingkungan', icon: '🌳' },
];

const SCHEDULES = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
];

const TIME_PREFERENCES = [
  { value: '05:00', label: 'Subuh (05:00)' },
  { value: '08:00', label: 'Pagi (08:00)' },
  { value: '12:00', label: 'Siang (12:00)' },
  { value: '18:00', label: 'Sore (18:00)' },
  { value: '21:00', label: 'Malam (21:00)' },
];

export default function DonasiOtomatisPage() {
  const { status } = useSession();
  const router = useRouter();

  const [settings, setSettings] = useState<AutoDonationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [balance, setBalance] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState(true);

  // Form state
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [schedule, setSchedule] = useState('daily');
  const [time, setTime] = useState('05:00');
  const [isActive, setIsActive] = useState(true);

  // UI state
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [amountError, setAmountError] = useState('');

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  // Load existing settings and balance
  useEffect(() => {
    if (status === 'authenticated') {
      // Fetch auto-donation settings
      fetch('/api/auto-donations')
        .then((res) => {
          if (res.ok) return res.json();
          if (res.status === 404) return null;
          throw new Error('Failed to fetch settings');
        })
        .then((data) => {
          if (data && data.settings) {
            const s = data.settings;
            setSettings(s);
            setAmount(String(s.amount));
            setCategory(s.category);
            setSchedule(s.schedule);
            setTime(s.time);
            setIsActive(s.isActive);
          }
        })
        .catch(() => {
          // No existing settings, that's fine
        })
        .finally(() => setIsLoading(false));

      // Fetch balance
      fetch('/api/balance')
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch balance');
          return res.json();
        })
        .then((data) => setBalance(data.balance ?? 0))
        .catch(() => setBalance(0))
        .finally(() => setBalanceLoading(false));
    }
  }, [status]);

  const validateAmount = (val: string): boolean => {
    const num = parseInt(val, 10);
    if (!val || isNaN(num)) {
      setAmountError('Masukkan jumlah donasi');
      return false;
    }
    if (num < 1000) {
      setAmountError('Minimum donasi Rp1.000');
      return false;
    }
    if (num > 10000000) {
      setAmountError('Maksimum donasi Rp10.000.000');
      return false;
    }
    setAmountError('');
    return true;
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess('');

    if (!validateAmount(amount)) return;
    if (!category) {
      setError('Pilih kategori donasi');
      return;
    }

    setIsSaving(true);

    try {
      const res = await fetch('/api/auto-donations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseInt(amount, 10),
          category,
          schedule,
          time,
          isActive,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || 'Gagal menyimpan pengaturan');
        return;
      }

      const data = await res.json();
      setSettings(data.settings);
      setSuccess('Pengaturan donasi otomatis berhasil disimpan!');
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setIsSaving(false);
    }
  };

  // Loading state
  if (status === 'loading' || isLoading) {
    return <PageSkeleton />;
  }

  // Redirecting
  if (status === 'unauthenticated') {
    return null;
  }

  const parsedAmount = parseInt(amount, 10) || 0;
  const isLowBalance = !balanceLoading && parsedAmount > 0 && balance < parsedAmount;

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-24">
      {/* Header */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-white"
            aria-label="Kembali"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-white text-lg font-semibold">Donasi Otomatis</h1>
        </div>
      </div>

      {/* Balance Info. Kantong Donasi top-up is disabled (WALLET_ENABLED,
          src/lib/wallet.ts), so there is no Top Up entry point here. */}
      <div className="bg-white mx-4 -mt-2 rounded-xl shadow-sm p-4">
        <div>
          <p className="text-[#757575] text-xs">Saldo Kantong Donasi</p>
          {balanceLoading ? (
            <div className="h-6 w-28 bg-[#E0E0E0] rounded animate-pulse mt-1" />
          ) : (
            <p className="text-[#212121] text-lg font-bold mt-0.5">
              {formatRupiah(balance)}
            </p>
          )}
        </div>
      </div>

      {/* Low Balance Warning */}
      {isLowBalance && (
        <div className="mx-4 mt-3 bg-[#FFF3E0] border border-[#FFB300] rounded-xl p-3 flex items-start gap-2">
          <svg className="w-5 h-5 text-[#FFB300] flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="text-[#212121] text-sm font-medium">Saldo tidak mencukupi</p>
            <p className="text-[#757575] text-xs mt-0.5">
              Saldo Anda ({formatRupiah(balance)}) kurang dari jumlah donasi ({formatRupiah(parsedAmount)}). 
              Donasi otomatis akan dijeda sampai saldo mencukupi.
            </p>
          </div>
        </div>
      )}

      {/* Current Status */}
      {settings && (
        <div className="mx-4 mt-3 bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[#212121] text-sm font-medium">Status Saat Ini</p>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                settings.isActive
                  ? 'bg-[#E8F5E9] text-[#00C853]'
                  : 'bg-[#FAFAFA] text-[#757575]'
              }`}
            >
              {settings.isActive ? 'Aktif' : 'Nonaktif'}
            </span>
          </div>
          <p className="text-[#757575] text-xs">
            {formatRupiah(settings.amount)} / {settings.schedule === 'daily' ? 'hari' : 'minggu'} • Kategori:{' '}
            {CATEGORIES.find((c) => c.slug === settings.category)?.name || settings.category}
          </p>
        </div>
      )}

      {/* Configuration Form */}
      <div className="mx-4 mt-3 bg-white rounded-xl shadow-sm p-4 space-y-5">
        <h2 className="text-[#212121] font-semibold text-base">
          {settings ? 'Ubah Pengaturan' : 'Atur Donasi Otomatis'}
        </h2>

        {/* Amount Input */}
        <Input
          type="number"
          label="Jumlah Donasi"
          placeholder="10000"
          value={amount}
          onChange={(val) => {
            setAmount(val);
            if (amountError) validateAmount(val);
          }}
          onBlur={() => validateAmount(amount)}
          error={amountError}
          prefix="Rp"
          helperText="Minimum Rp1.000"
          required
        />

        {/* Category Selector */}
        <div>
          <label className="block text-sm font-medium text-[#212121] mb-2">
            Kategori Donasi <span className="text-[#D50000]">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.slug}
                type="button"
                onClick={() => setCategory(cat.slug)}
                className={`flex items-center gap-2 p-3 rounded-lg border text-left text-sm transition-colors ${
                  category === cat.slug
                    ? 'border-[#0073E6] bg-[#E3F2FD] text-[#0073E6] font-medium'
                    : 'border-[#E0E0E0] text-[#212121] hover:border-[#757575]'
                }`}
                aria-pressed={category === cat.slug}
              >
                <span className="text-lg" aria-hidden="true">{cat.icon}</span>
                <span className="truncate">{cat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Schedule Selector */}
        <div>
          <label className="block text-sm font-medium text-[#212121] mb-2">
            Jadwal
          </label>
          <div className="flex gap-2">
            {SCHEDULES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSchedule(s.value)}
                className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  schedule === s.value
                    ? 'border-[#0073E6] bg-[#E3F2FD] text-[#0073E6]'
                    : 'border-[#E0E0E0] text-[#212121] hover:border-[#757575]'
                }`}
                aria-pressed={schedule === s.value}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time Preference */}
        <div>
          <label className="block text-sm font-medium text-[#212121] mb-2">
            Waktu Donasi
          </label>
          <div className="flex flex-wrap gap-2">
            {TIME_PREFERENCES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTime(t.value)}
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  time === t.value
                    ? 'border-[#0073E6] bg-[#E3F2FD] text-[#0073E6] font-medium'
                    : 'border-[#E0E0E0] text-[#212121] hover:border-[#757575]'
                }`}
                aria-pressed={time === t.value}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between pt-2 border-t border-[#E0E0E0]">
          <div>
            <p className="text-[#212121] text-sm font-medium">Aktifkan Donasi Otomatis</p>
            <p className="text-[#757575] text-xs mt-0.5">
              Donasi akan diproses sesuai jadwal yang dipilih
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive(!isActive)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isActive ? 'bg-[#0073E6]' : 'bg-[#E0E0E0]'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                isActive ? 'translate-x-[22px]' : 'translate-x-[2px]'
              }`}
            />
          </button>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="bg-[#FFEBEE] border border-[#D50000]/20 rounded-lg p-3">
            <p className="text-[#D50000] text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-[#E8F5E9] border border-[#00C853]/20 rounded-lg p-3">
            <p className="text-[#00C853] text-sm">{success}</p>
          </div>
        )}

        {/* Submit Button */}
        <Button
          variant="primary"
          size="full"
          onClick={handleSubmit}
          isLoading={isSaving}
          disabled={isSaving}
        >
          {settings ? 'Simpan Perubahan' : 'Aktifkan Donasi Otomatis'}
        </Button>
      </div>

      {/* Info Section */}
      <div className="mx-4 mt-3 bg-white rounded-xl shadow-sm p-4">
        <h3 className="text-[#212121] text-sm font-medium mb-2">Tentang Donasi Otomatis</h3>
        <ul className="space-y-2 text-[#757575] text-xs">
          <li className="flex items-start gap-2">
            <span className="text-[#0073E6] mt-0.5">•</span>
            Donasi akan otomatis dikirim dari saldo kantong donasi sesuai jadwal
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#0073E6] mt-0.5">•</span>
            Jika saldo tidak mencukupi, donasi otomatis akan dijeda dan Anda akan diberitahu
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#0073E6] mt-0.5">•</span>
            Anda bisa menonaktifkan donasi otomatis kapan saja
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#0073E6] mt-0.5">•</span>
            Donasi akan didistribusikan ke campaign aktif dalam kategori yang dipilih
          </li>
        </ul>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-24">
      {/* Header skeleton */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-white/20 rounded" />
          <div className="h-5 w-36 bg-white/20 rounded" />
        </div>
      </div>

      {/* Balance skeleton */}
      <div className="bg-white mx-4 -mt-2 rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-3 w-28 bg-[#E0E0E0] rounded animate-pulse" />
            <div className="h-6 w-24 bg-[#E0E0E0] rounded animate-pulse" />
          </div>
          <div className="h-4 w-12 bg-[#E0E0E0] rounded animate-pulse" />
        </div>
      </div>

      {/* Form skeleton */}
      <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm p-4 space-y-5">
        <div className="h-5 w-40 bg-[#E0E0E0] rounded animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 w-24 bg-[#E0E0E0] rounded animate-pulse" />
          <div className="h-10 w-full bg-[#E0E0E0] rounded animate-pulse" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-28 bg-[#E0E0E0] rounded animate-pulse" />
          <div className="grid grid-cols-2 gap-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-12 bg-[#E0E0E0] rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-4 w-16 bg-[#E0E0E0] rounded animate-pulse" />
          <div className="flex gap-2">
            <div className="flex-1 h-10 bg-[#E0E0E0] rounded-lg animate-pulse" />
            <div className="flex-1 h-10 bg-[#E0E0E0] rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="h-12 w-full bg-[#E0E0E0] rounded-lg animate-pulse" />
      </div>
    </div>
  );
}
