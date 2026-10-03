'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { calculateZakat, calculateZakatFitrah } from '@/lib/utils/zakat';
import { formatRupiah } from '@/lib/utils/currency';

type ZakatType = 'mal' | 'fitrah' | 'infaq' | 'sedekah';

const ZAKAT_TYPES: { id: ZakatType; label: string; icon: string; description: string }[] = [
  { id: 'mal', label: 'Zakat Mal', icon: '💰', description: 'Zakat harta kekayaan' },
  { id: 'fitrah', label: 'Zakat Fitrah', icon: '🌾', description: 'Zakat jiwa di bulan Ramadhan' },
  { id: 'infaq', label: 'Infaq', icon: '🤲', description: 'Sedekah harta di jalan Allah' },
  { id: 'sedekah', label: 'Sedekah', icon: '❤️', description: 'Pemberian sukarela' },
];

/** Nisab threshold: approximately 85 grams of gold (~Rp85.000.000) */
const NISAB_THRESHOLD = 85000000;

/** Fixed Zakat Fitrah amount per person (approx 3.5kg rice) */
const FITRAH_PER_PERSON = 35000;

export default function ZakatPage() {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<ZakatType>('mal');

  // Zakat Mal state
  const [assets, setAssets] = useState('');
  const [debts, setDebts] = useState('');

  // Zakat Fitrah state
  const [people, setPeople] = useState('1');

  // Infaq / Sedekah state
  const [customAmount, setCustomAmount] = useState('');

  /** Parse currency input string to number */
  const parseInput = (value: string): number => {
    const cleaned = value.replace(/\D/g, '');
    return parseInt(cleaned, 10) || 0;
  };

  /** Format number for display in input */
  const formatInputValue = (value: string): string => {
    const num = parseInput(value);
    if (num === 0) return '';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  // Zakat Mal calculation
  const zakatMalResult = useMemo(() => {
    const totalAssets = parseInput(assets);
    const totalDebts = parseInput(debts);
    const netAssets = Math.max(totalAssets - totalDebts, 0);
    const zakatAmount = calculateZakat(netAssets, NISAB_THRESHOLD);
    return {
      totalAssets,
      totalDebts,
      netAssets,
      zakatAmount,
      meetsNisab: netAssets >= NISAB_THRESHOLD,
    };
  }, [assets, debts]);

  // Zakat Fitrah calculation
  const zakatFitrahResult = useMemo(() => {
    const numPeople = parseInt(people, 10) || 0;
    const amount = calculateZakatFitrah(FITRAH_PER_PERSON / 3.5, numPeople);
    return {
      numPeople,
      amount,
    };
  }, [people]);

  /** Get the final calculated amount based on selected type */
  const getFinalAmount = (): number => {
    switch (selectedType) {
      case 'mal':
        return zakatMalResult.zakatAmount;
      case 'fitrah':
        return zakatFitrahResult.amount;
      case 'infaq':
      case 'sedekah':
        return parseInput(customAmount);
      default:
        return 0;
    }
  };

  const handleBayarZakat = () => {
    const amount = getFinalAmount();
    if (amount <= 0) return;
    // Navigate to explore page filtered by zakat category with amount as query param
    router.push(`/explore/all?category=zakat&amount=${amount}`);
  };

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      {/* Header */}
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <h1 className="text-white text-lg font-semibold">Zakat & Donasi</h1>
        <p className="text-white/80 text-sm mt-1">
          Tunaikan kewajiban dan salurkan kebaikan
        </p>
      </div>

      {/* Zakat Type Selector */}
      <div className="px-4 mt-4">
        <div className="grid grid-cols-2 gap-3">
          {ZAKAT_TYPES.map((type) => (
            <button
              key={type.id}
              onClick={() => setSelectedType(type.id)}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                selectedType === type.id
                  ? 'border-[#0073E6] bg-[#E3F2FD] shadow-xs'
                  : 'border-border bg-white hover:border-[#90CAF9]'
              }`}
            >
              <span className="text-2xl">{type.icon}</span>
              <div className="text-left">
                <p
                  className={`text-sm font-semibold ${
                    selectedType === type.id ? 'text-[#0073E6]' : 'text-text'
                  }`}
                >
                  {type.label}
                </p>
                <p className="text-xs text-text-secondary leading-tight">{type.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Calculator Section */}
      <div className="px-4 mt-6">
        <div className="bg-white rounded-xl shadow-xs p-4">
          {selectedType === 'mal' && (
            <ZakatMalCalculator
              assets={assets}
              debts={debts}
              onAssetsChange={setAssets}
              onDebtsChange={setDebts}
              result={zakatMalResult}
              formatInputValue={formatInputValue}
            />
          )}

          {selectedType === 'fitrah' && (
            <ZakatFitrahCalculator
              people={people}
              onPeopleChange={setPeople}
              result={zakatFitrahResult}
            />
          )}

          {(selectedType === 'infaq' || selectedType === 'sedekah') && (
            <CustomAmountInput
              type={selectedType}
              amount={customAmount}
              onAmountChange={setCustomAmount}
              formatInputValue={formatInputValue}
            />
          )}
        </div>
      </div>

      {/* Pay Zakat Button */}
      <div className="px-4 mt-6">
        <button
          onClick={handleBayarZakat}
          disabled={getFinalAmount() <= 0}
          className={`w-full py-3.5 rounded-xl text-white text-sm font-semibold transition-colors ${
            getFinalAmount() > 0
              ? 'bg-[#0073E6] hover:bg-[#005BB5] active:bg-[#004A99]'
              : 'bg-[#BDBDBD] cursor-not-allowed'
          }`}
        >
          {getFinalAmount() > 0
            ? `Bayar Zakat - ${formatRupiah(getFinalAmount())}`
            : 'Bayar Zakat'}
        </button>
      </div>
    </div>
  );
}

/** Zakat Mal Calculator Form */
function ZakatMalCalculator({
  assets,
  debts,
  onAssetsChange,
  onDebtsChange,
  result,
  formatInputValue,
}: {
  assets: string;
  debts: string;
  onAssetsChange: (value: string) => void;
  onDebtsChange: (value: string) => void;
  result: {
    totalAssets: number;
    totalDebts: number;
    netAssets: number;
    zakatAmount: number;
    meetsNisab: boolean;
  };
  formatInputValue: (value: string) => string;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-text">Kalkulator Zakat Mal</h2>

      {/* Nisab info */}
      <div className="bg-[#E8F5E9] rounded-lg p-3">
        <p className="text-xs text-[#2E7D32] font-medium">Nisab (setara 85 gram emas)</p>
        <p className="text-sm text-[#1B5E20] font-bold mt-0.5">
          {formatRupiah(NISAB_THRESHOLD)}
        </p>
      </div>

      {/* Total Assets Input */}
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">
          Total Harta (tabungan, investasi, emas, dll)
        </label>
        <div className="flex items-center border border-border rounded-lg overflow-hidden focus-within:border-[#0073E6] focus-within:ring-1 focus-within:ring-[#0073E6]">
          <span className="px-3 py-2.5 bg-bg-secondary text-sm text-text-secondary font-medium border-r border-border">
            Rp
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={formatInputValue(assets)}
            onChange={(e) => onAssetsChange(e.target.value)}
            placeholder="0"
            className="flex-1 px-3 py-2.5 text-sm text-text outline-hidden"
          />
        </div>
      </div>

      {/* Debts Input */}
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">
          Hutang / Kewajiban
        </label>
        <div className="flex items-center border border-border rounded-lg overflow-hidden focus-within:border-[#0073E6] focus-within:ring-1 focus-within:ring-[#0073E6]">
          <span className="px-3 py-2.5 bg-bg-secondary text-sm text-text-secondary font-medium border-r border-border">
            Rp
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={formatInputValue(debts)}
            onChange={(e) => onDebtsChange(e.target.value)}
            placeholder="0"
            className="flex-1 px-3 py-2.5 text-sm text-text outline-hidden"
          />
        </div>
      </div>

      {/* Calculation Result */}
      {result.totalAssets > 0 && (
        <div className="border-t border-border pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Harta bersih</span>
            <span className="text-text font-medium">
              {formatRupiah(result.netAssets)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Nisab</span>
            <span className="text-text font-medium">
              {formatRupiah(NISAB_THRESHOLD)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Status</span>
            <span
              className={`font-medium ${
                result.meetsNisab ? 'text-[#2E7D32]' : 'text-[#F57F17]'
              }`}
            >
              {result.meetsNisab ? 'Wajib Zakat' : 'Belum mencapai nisab'}
            </span>
          </div>
          {result.meetsNisab && (
            <div className="bg-[#E3F2FD] rounded-lg p-3 mt-2">
              <p className="text-xs text-[#0073E6] font-medium">Zakat yang harus dibayar (2.5%)</p>
              <p className="text-lg text-[#0073E6] font-bold mt-0.5">
                {formatRupiah(result.zakatAmount)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Zakat Fitrah Calculator */
function ZakatFitrahCalculator({
  people,
  onPeopleChange,
  result,
}: {
  people: string;
  onPeopleChange: (value: string) => void;
  result: {
    numPeople: number;
    amount: number;
  };
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-text">Kalkulator Zakat Fitrah</h2>

      {/* Info */}
      <div className="bg-[#FFF3E0] rounded-lg p-3">
        <p className="text-xs text-[#E65100] font-medium">Zakat Fitrah per orang</p>
        <p className="text-sm text-[#BF360C] font-bold mt-0.5">
          {formatRupiah(FITRAH_PER_PERSON)} / jiwa
        </p>
      </div>

      {/* Number of People */}
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">
          Jumlah Jiwa
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const current = parseInt(people, 10) || 1;
              if (current > 1) onPeopleChange(String(current - 1));
            }}
            className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-lg font-bold text-text-secondary hover:bg-bg-secondary transition-colors"
            aria-label="Kurangi jumlah jiwa"
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            value={people}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '');
              onPeopleChange(val || '1');
            }}
            className="w-16 text-center border border-border rounded-lg py-2 text-sm text-text font-semibold outline-hidden focus:border-[#0073E6]"
          />
          <button
            onClick={() => {
              const current = parseInt(people, 10) || 0;
              onPeopleChange(String(current + 1));
            }}
            className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-lg font-bold text-text-secondary hover:bg-bg-secondary transition-colors"
            aria-label="Tambah jumlah jiwa"
          >
            +
          </button>
        </div>
      </div>

      {/* Result */}
      {result.numPeople > 0 && (
        <div className="bg-[#E3F2FD] rounded-lg p-3 mt-2">
          <p className="text-xs text-[#0073E6] font-medium">
            Total Zakat Fitrah ({result.numPeople} jiwa)
          </p>
          <p className="text-lg text-[#0073E6] font-bold mt-0.5">
            {formatRupiah(result.amount)}
          </p>
        </div>
      )}
    </div>
  );
}

/** Custom Amount Input for Infaq/Sedekah */
function CustomAmountInput({
  type,
  amount,
  onAmountChange,
  formatInputValue,
}: {
  type: 'infaq' | 'sedekah';
  amount: string;
  onAmountChange: (value: string) => void;
  formatInputValue: (value: string) => string;
}) {
  const title = type === 'infaq' ? 'Infaq' : 'Sedekah';
  const description =
    type === 'infaq'
      ? 'Salurkan infaq Anda untuk kebaikan umat'
      : 'Berikan sedekah terbaik Anda';

  const presets = [10000, 25000, 50000, 100000, 250000, 500000];

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="text-sm text-text-secondary">{description}</p>

      {/* Preset amounts */}
      <div className="grid grid-cols-3 gap-2">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => onAmountChange(String(preset))}
            className={`py-2 px-2 rounded-lg border text-xs font-medium transition-colors ${
              parseInt(amount.replace(/\D/g, ''), 10) === preset
                ? 'border-[#0073E6] bg-[#E3F2FD] text-[#0073E6]'
                : 'border-border text-text hover:border-[#90CAF9]'
            }`}
          >
            {formatRupiah(preset)}
          </button>
        ))}
      </div>

      {/* Custom amount */}
      <div>
        <label className="block text-sm font-medium text-text mb-1.5">
          Nominal lainnya
        </label>
        <div className="flex items-center border border-border rounded-lg overflow-hidden focus-within:border-[#0073E6] focus-within:ring-1 focus-within:ring-[#0073E6]">
          <span className="px-3 py-2.5 bg-bg-secondary text-sm text-text-secondary font-medium border-r border-border">
            Rp
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={formatInputValue(amount)}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="0"
            className="flex-1 px-3 py-2.5 text-sm text-text outline-hidden"
          />
        </div>
      </div>
    </div>
  );
}
