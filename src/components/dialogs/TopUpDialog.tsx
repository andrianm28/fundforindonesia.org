'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatRupiah } from '@/lib/utils/currency';

interface TopUpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = 'amount' | 'payment' | 'confirmation';

const PRESET_AMOUNTS = [25000, 50000, 100000, 250000];

const PAYMENT_METHODS = [
  { id: 'BCA', name: 'BCA', type: 'Bank Transfer' },
  { id: 'Mandiri', name: 'Mandiri', type: 'Bank Transfer' },
  { id: 'BNI', name: 'BNI', type: 'Bank Transfer' },
  { id: 'GoPay', name: 'GoPay', type: 'E-Wallet' },
  { id: 'OVO', name: 'OVO', type: 'E-Wallet' },
  { id: 'Dana', name: 'Dana', type: 'E-Wallet' },
];

const MIN_AMOUNT = 10000;
const MAX_AMOUNT = 10000000;

export function TopUpDialog({ isOpen, onClose, onSuccess }: TopUpDialogProps) {
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const resetState = useCallback(() => {
    setStep('amount');
    setAmount(null);
    setCustomAmount('');
    setPaymentMethod('');
    setIsLoading(false);
    setError('');
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleCustomAmountChange = (value: string) => {
    // Strip non-numeric characters
    const numericOnly = value.replace(/[^0-9]/g, '');
    setCustomAmount(numericOnly);

    if (numericOnly === '') {
      setAmount(null);
      setError('');
    } else {
      const numValue = parseInt(numericOnly, 10);
      setAmount(numValue);

      if (numValue < MIN_AMOUNT) {
        setError('Minimum top up Rp10.000');
      } else if (numValue > MAX_AMOUNT) {
        setError('Maksimum top up Rp10.000.000');
      } else {
        setError('');
      }
    }
  };

  const handlePresetSelect = (presetAmount: number) => {
    setAmount(presetAmount);
    setCustomAmount('');
    setError('');
  };

  const isAmountValid = amount !== null && amount >= MIN_AMOUNT && amount <= MAX_AMOUNT;

  const handleNextToPayment = () => {
    if (isAmountValid) {
      setStep('payment');
    }
  };

  const handleConfirm = async () => {
    if (!amount || !paymentMethod) return;

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/user/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, paymentMethod }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Gagal melakukan top up');
        setIsLoading(false);
        return;
      }

      setStep('confirmation');
      setIsLoading(false);
      onSuccess?.();
    } catch {
      setError('Terjadi kesalahan jaringan');
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="topup-dialog-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Dialog Panel */}
      <div className="relative bg-white rounded-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#E0E0E0]">
          <h2 id="topup-dialog-title" className="text-lg font-semibold text-[#212121]">
            {step === 'amount' && 'Top Up Saldo'}
            {step === 'payment' && 'Pilih Metode Pembayaran'}
            {step === 'confirmation' && 'Top Up Berhasil'}
          </h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-full hover:bg-[#F5F5F5] transition-colors"
            aria-label="Tutup"
          >
            <svg className="w-5 h-5 text-[#757575]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {step === 'amount' && (
            <AmountStep
              amount={amount}
              customAmount={customAmount}
              error={error}
              onPresetSelect={handlePresetSelect}
              onCustomAmountChange={handleCustomAmountChange}
              onNext={handleNextToPayment}
              isValid={isAmountValid}
            />
          )}

          {step === 'payment' && (
            <PaymentStep
              amount={amount!}
              paymentMethod={paymentMethod}
              onSelectMethod={setPaymentMethod}
              onConfirm={handleConfirm}
              onBack={() => setStep('amount')}
              isLoading={isLoading}
              error={error}
            />
          )}

          {step === 'confirmation' && (
            <ConfirmationStep
              amount={amount!}
              paymentMethod={paymentMethod}
              onClose={handleClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Step 1: Amount Selection
function AmountStep({
  amount,
  customAmount,
  error,
  onPresetSelect,
  onCustomAmountChange,
  onNext,
  isValid,
}: {
  amount: number | null;
  customAmount: string;
  error: string;
  onPresetSelect: (amount: number) => void;
  onCustomAmountChange: (value: string) => void;
  onNext: () => void;
  isValid: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[#757575]">Pilih nominal top up</p>

      {/* Preset Amounts */}
      <div className="grid grid-cols-2 gap-3">
        {PRESET_AMOUNTS.map((preset) => (
          <button
            key={preset}
            onClick={() => onPresetSelect(preset)}
            className={`py-3 px-4 rounded-xl text-sm font-medium border-2 transition-colors ${
              amount === preset && customAmount === ''
                ? 'border-[#0073E6] bg-blue-50 text-[#0073E6]'
                : 'border-[#E0E0E0] text-[#212121] hover:border-[#0073E6] hover:bg-blue-50'
            }`}
          >
            {formatRupiah(preset)}
          </button>
        ))}
      </div>

      {/* Custom Amount Input */}
      <div>
        <label className="text-sm text-[#757575] block mb-1.5">Atau masukkan nominal lain</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#757575] text-sm">Rp</span>
          <input
            type="text"
            inputMode="numeric"
            value={customAmount}
            onChange={(e) => onCustomAmountChange(e.target.value)}
            placeholder="0"
            className={`w-full pl-9 pr-4 py-3 rounded-xl border-2 text-sm focus:outline-none transition-colors ${
              error
                ? 'border-[#D50000] focus:border-[#D50000]'
                : 'border-[#E0E0E0] focus:border-[#0073E6]'
            }`}
          />
        </div>
        {error && (
          <p className="text-xs text-[#D50000] mt-1">{error}</p>
        )}
        {customAmount && !error && (
          <p className="text-xs text-[#757575] mt-1">
            {formatRupiah(parseInt(customAmount, 10))}
          </p>
        )}
      </div>

      {/* Next Button */}
      <button
        onClick={onNext}
        disabled={!isValid}
        className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
          isValid
            ? 'bg-[#0073E6] text-white hover:bg-[#005BB5]'
            : 'bg-[#E0E0E0] text-[#9E9E9E] cursor-not-allowed'
        }`}
      >
        Lanjutkan
      </button>
    </div>
  );
}

// Step 2: Payment Method Selection
function PaymentStep({
  amount,
  paymentMethod,
  onSelectMethod,
  onConfirm,
  onBack,
  isLoading,
  error,
}: {
  amount: number;
  paymentMethod: string;
  onSelectMethod: (method: string) => void;
  onConfirm: () => void;
  onBack: () => void;
  isLoading: boolean;
  error: string;
}) {
  return (
    <div className="space-y-4">
      {/* Amount Summary */}
      <div className="bg-[#F5F5F5] rounded-xl p-3 flex items-center justify-between">
        <span className="text-sm text-[#757575]">Nominal top up</span>
        <span className="text-sm font-semibold text-[#212121]">{formatRupiah(amount)}</span>
      </div>

      {/* Payment Methods */}
      <div>
        <p className="text-sm text-[#757575] mb-2">Pilih metode pembayaran</p>
        <div className="space-y-2">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method.id}
              onClick={() => onSelectMethod(method.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-colors text-left ${
                paymentMethod === method.id
                  ? 'border-[#0073E6] bg-blue-50'
                  : 'border-[#E0E0E0] hover:border-[#0073E6]'
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-[#F5F5F5] flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-[#212121]">{method.id.substring(0, 3)}</span>
              </div>
              <div>
                <p className="text-sm font-medium text-[#212121]">{method.name}</p>
                <p className="text-xs text-[#757575]">{method.type}</p>
              </div>
              {paymentMethod === method.id && (
                <svg className="w-5 h-5 text-[#0073E6] ml-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-[#D50000]">{error}</p>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={isLoading}
          className="flex-1 py-3 rounded-xl text-sm font-semibold border-2 border-[#E0E0E0] text-[#212121] hover:bg-[#F5F5F5] transition-colors"
        >
          Kembali
        </button>
        <button
          onClick={onConfirm}
          disabled={!paymentMethod || isLoading}
          className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-colors ${
            paymentMethod && !isLoading
              ? 'bg-[#0073E6] text-white hover:bg-[#005BB5]'
              : 'bg-[#E0E0E0] text-[#9E9E9E] cursor-not-allowed'
          }`}
        >
          {isLoading ? 'Memproses...' : 'Konfirmasi'}
        </button>
      </div>
    </div>
  );
}

// Step 3: Confirmation
function ConfirmationStep({
  amount,
  paymentMethod,
  onClose,
}: {
  amount: number;
  paymentMethod: string;
  onClose: () => void;
}) {
  const methodInfo = PAYMENT_METHODS.find((m) => m.id === paymentMethod);

  return (
    <div className="text-center space-y-4 py-4">
      {/* Success Icon */}
      <div className="w-16 h-16 rounded-full bg-[#E8F5E9] flex items-center justify-center mx-auto">
        <svg className="w-8 h-8 text-[#00C853]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      {/* Summary */}
      <div>
        <h3 className="text-lg font-semibold text-[#212121]">Top Up Berhasil!</h3>
        <p className="text-sm text-[#757575] mt-1">
          Saldo Anda telah ditambahkan sebesar
        </p>
        <p className="text-xl font-bold text-[#0073E6] mt-1">{formatRupiah(amount)}</p>
      </div>

      {/* Payment Info */}
      <div className="bg-[#F5F5F5] rounded-xl p-4 text-left">
        <p className="text-xs text-[#757575] mb-1">Metode Pembayaran</p>
        <p className="text-sm font-medium text-[#212121]">{methodInfo?.name} ({methodInfo?.type})</p>

        <p className="text-xs text-[#757575] mt-3 mb-1">Instruksi</p>
        {methodInfo?.type === 'Bank Transfer' ? (
          <p className="text-sm text-[#212121]">
            Transfer ke rekening {methodInfo.name} Virtual Account yang akan dikirim via notifikasi.
          </p>
        ) : (
          <p className="text-sm text-[#212121]">
            Pembayaran akan diproses melalui aplikasi {methodInfo?.name} Anda.
          </p>
        )}
      </div>

      {/* Close Button */}
      <button
        onClick={onClose}
        className="w-full py-3 rounded-xl text-sm font-semibold bg-[#0073E6] text-white hover:bg-[#005BB5] transition-colors"
      >
        Selesai
      </button>
    </div>
  );
}
