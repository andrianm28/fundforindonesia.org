'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCampaignDetail } from '@/lib/hooks/useCampaignDetail';
import { DonationAmountSelector } from '@/components/donation/DonationAmountSelector';
import { PaymentMethodSelector } from '@/components/donation/PaymentMethodSelector';
import { DonationConfirmation } from '@/components/donation/DonationConfirmation';
import { formatRupiah } from '@/lib/utils/currency';
import type { PaymentMethod } from '@/types/donation';

const PRESET_AMOUNTS = [10000, 25000, 50000, 100000, 500000];
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 1000000000;

const paymentMethods: PaymentMethod[] = [
  { id: 'bca', name: 'BCA Virtual Account', type: 'bank_transfer', icon: '🏦', fee: 2500 },
  { id: 'bni', name: 'BNI Virtual Account', type: 'bank_transfer', icon: '🏦', fee: 2500 },
  { id: 'gopay', name: 'GoPay', type: 'ewallet', icon: '📱', fee: 1000 },
  { id: 'ovo', name: 'OVO', type: 'ewallet', icon: '📱', fee: 1000 },
  { id: 'visa', name: 'Visa/Mastercard', type: 'credit_card', icon: '💳', fee: 5000 },
];

export default function DonatePage() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params.slug === 'string' ? params.slug : '';

  const { campaign, isLoading, error } = useCampaignDetail(slug);

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);
  const [prayer, setPrayer] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!campaign || !selectedAmount || !selectedPaymentMethod) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/donations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          amount: selectedAmount,
          paymentMethod: selectedPaymentMethod.id,
          message: prayer || undefined,
          isAnonymous,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Gagal memproses donasi');
      }

      setCurrentStep(4);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal memproses donasi');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-text-secondary">Memuat...</div>
      </div>
    );
  }

  // Error state
  if (error || !campaign) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-text-secondary text-center">
          Kampanye tidak ditemukan atau terjadi kesalahan.
        </p>
        <button
          onClick={() => router.back()}
          className="text-primary font-medium hover:underline"
        >
          Kembali
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-secondary">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-border px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {currentStep < 4 && (
            <button
              onClick={() => {
                if (currentStep === 1) {
                  router.back();
                } else {
                  setCurrentStep(currentStep - 1);
                }
              }}
              className="text-text hover:text-primary transition-colors"
              aria-label="Kembali"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
          <h1 className="text-base font-semibold text-text flex-1">
            {currentStep === 4 ? 'Donasi Berhasil' : 'Donasi'}
          </h1>
        </div>
      </header>

      {/* Step Indicator */}
      {currentStep < 4 && (
        <div className="bg-white px-4 py-3 border-b border-border">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((step) => (
                <React.Fragment key={step}>
                  <div
                    className={[
                      'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold',
                      step === currentStep
                        ? 'bg-primary text-white'
                        : step < currentStep
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 text-gray-500',
                    ].join(' ')}
                  >
                    {step < currentStep ? '✓' : step}
                  </div>
                  {step < 3 && (
                    <div
                      className={[
                        'flex-1 h-0.5',
                        step < currentStep ? 'bg-green-500' : 'bg-gray-200',
                      ].join(' ')}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-text-secondary">Nominal</span>
              <span className="text-xs text-text-secondary">Pembayaran</span>
              <span className="text-xs text-text-secondary">Konfirmasi</span>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Info Banner */}
      {currentStep < 4 && (
        <div className="bg-white px-4 py-3 border-b border-border">
          <div className="max-w-lg mx-auto">
            <p className="text-xs text-text-secondary">Donasi untuk:</p>
            <p className="text-sm font-medium text-text line-clamp-1">
              {campaign.title}
            </p>
          </div>
        </div>
      )}

      {/* Step Content */}
      <main className="max-w-lg mx-auto px-4 py-6">
        {/* Step 1: Amount Selection */}
        {currentStep === 1 && (
          <DonationAmountSelector
            presets={PRESET_AMOUNTS}
            minAmount={MIN_AMOUNT}
            maxAmount={MAX_AMOUNT}
            selectedAmount={selectedAmount}
            onAmountChange={setSelectedAmount}
            onNext={() => setCurrentStep(2)}
          />
        )}

        {/* Step 2: Payment Method */}
        {currentStep === 2 && (
          <PaymentMethodSelector
            methods={paymentMethods}
            selectedMethod={selectedPaymentMethod}
            onSelect={setSelectedPaymentMethod}
            onNext={() => setCurrentStep(3)}
          />
        )}

        {/* Step 3: Confirmation */}
        {currentStep === 3 && selectedAmount && selectedPaymentMethod && (
          <div className="flex flex-col gap-4">
            <DonationConfirmation
              campaign={campaign}
              amount={selectedAmount}
              paymentMethod={selectedPaymentMethod}
              prayer={prayer}
              isAnonymous={isAnonymous}
              onPrayerChange={setPrayer}
              onAnonymousToggle={setIsAnonymous}
              onConfirm={handleConfirm}
              isSubmitting={isSubmitting}
            />
            {submitError && (
              <p className="text-sm text-danger text-center" role="alert">
                {submitError}
              </p>
            )}
          </div>
        )}

        {/* Step 4: Success */}
        {currentStep === 4 && (
          <div className="flex flex-col items-center text-center gap-6 py-8">
            {/* Checkmark Icon */}
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
              <svg
                className="w-10 h-10 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>

            {/* Success Message */}
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-text">Donasi Berhasil!</h2>
              <p className="text-text-secondary text-sm">
                Terima kasih atas kebaikanmu
              </p>
            </div>

            {/* Donation Details */}
            <div className="bg-gray-50 rounded-lg p-4 w-full space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Nominal</span>
                <span className="text-sm font-semibold text-text">
                  {selectedAmount ? formatRupiah(selectedAmount) : '-'}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-secondary">Kampanye</span>
                <span className="text-sm font-medium text-text text-right max-w-[60%]">
                  {campaign.title}
                </span>
              </div>
              {selectedPaymentMethod && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Pembayaran</span>
                  <span className="text-sm font-medium text-text">
                    {selectedPaymentMethod.name}
                  </span>
                </div>
              )}
            </div>

            {/* Back to Campaign Button */}
            <button
              onClick={() => router.push(`/campaign/${slug}`)}
              className="w-full py-3 rounded-md font-medium text-base bg-primary text-white hover:bg-primary-dark transition-colors"
            >
              Kembali ke Campaign
            </button>

            {/* Share Options */}
            <div className="space-y-2 w-full">
              <p className="text-sm text-text-secondary">Bagikan kebaikanmu:</p>
              <div className="flex justify-center gap-4">
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/campaign/${slug}`;
                    const text = `Saya baru saja berdonasi untuk "${campaign.title}". Ayo berdonasi juga!`;
                    window.open(
                      `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`,
                      '_blank'
                    );
                  }}
                  className="p-2 rounded-full bg-green-100 hover:bg-green-200 transition-colors"
                  aria-label="Bagikan ke WhatsApp"
                >
                  <span className="text-xl">💬</span>
                </button>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/campaign/${slug}`;
                    window.open(
                      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
                      '_blank'
                    );
                  }}
                  className="p-2 rounded-full bg-blue-100 hover:bg-blue-200 transition-colors"
                  aria-label="Bagikan ke Facebook"
                >
                  <span className="text-xl">📘</span>
                </button>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/campaign/${slug}`;
                    navigator.clipboard.writeText(url);
                  }}
                  className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                  aria-label="Salin tautan"
                >
                  <span className="text-xl">🔗</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
