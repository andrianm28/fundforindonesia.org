'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { useCampaignDetail } from '@/lib/hooks/useCampaignDetail';
import { DonationAmountSelector } from '@/components/donation/DonationAmountSelector';
import { PaymentMethodSelector } from '@/components/donation/PaymentMethodSelector';
import { DonationConfirmation } from '@/components/donation/DonationConfirmation';
import { formatRupiah } from '@/lib/utils/currency';
import { donationsEnabled, DONATIONS_DISABLED_MESSAGE } from '@/lib/donations';
import { COLLECTING_ENTITY_REFUSAL, offersDonating, statusBannerCopy } from '@/lib/campaign-page-status';
import { readCapturedTrafficSource } from '@/lib/traffic-source-capture';
import type { PaymentMethod } from '@/types/donation';

const PRESET_AMOUNTS = [20000, 50000, 100000, 250000, 500000];
const MIN_AMOUNT = 20000;
const MAX_AMOUNT = 1000000000;

/**
 * Only what the payment provider can actually charge.
 *
 * This list used to offer virtual accounts, e-wallets and cards. None of
 * them had an integration behind them, so choosing one led to a 503 after
 * the donor had already picked an amount. Sumopod is QRIS only, and every
 * Indonesian mobile banking and e-wallet app pays a QRIS code, so this is
 * one entry rather than five dead ones.
 *
 * `fee` is 0 because nothing here ever reached the provider: the old numbers
 * (Rp2.500, Rp1.000, Rp5.000) were displayed to the donor and added to the
 * total on screen, while the API was sent the amount alone and charged
 * exactly that. A fee shown but never charged is worse than no fee shown.
 */
const paymentMethods: PaymentMethod[] = [
  { id: 'qris', name: 'QRIS', type: 'qris', icon: '📷', fee: 0 },
];

export default function DonatePage() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params.slug === 'string' ? params.slug : '';

  const { campaign, isLoading, error, notFound } = useCampaignDetail(slug);
  const { status: sessionStatus } = useSession();
  const isGuest = sessionStatus !== 'authenticated';

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);
  const [prayer, setPrayer] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // A Guest Donor's contact details (CONTEXT.md, Guest Donor;
  // prd-compliance 18): email required, name and phone optional. Unused and
  // never sent for a signed-in Donor.
  const [guestEmail, setGuestEmail] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmailError, setGuestEmailError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!campaign || !selectedAmount || !selectedPaymentMethod) return;

    if (isGuest && !guestEmail.trim()) {
      setGuestEmailError('Email harus diisi untuk donasi tanpa akun');
      return;
    }
    setGuestEmailError(null);

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/donations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          amount: selectedAmount,
          // The API validates the method TYPE ("qris"), not the display id.
          // Sending the id meant every submission was rejected as an invalid
          // payment method -- invisible while the endpoint was gated shut.
          paymentMethod: selectedPaymentMethod.type,
          message: prayer || undefined,
          isAnonymous,
          // Traffic Source (ticket 24): whatever `src` this Donor's shared
          // link carried, captured on the Campaign page and read back here
          // since it is a separate route. Sanitized again at the API
          // (src/lib/traffic-source.ts) either way -- this is convenience,
          // never the trust boundary.
          trafficSource: readCapturedTrafficSource(slug) ?? undefined,
          ...(isGuest && {
            guestEmail: guestEmail.trim(),
            guestName: guestName.trim() || undefined,
            guestPhone: guestPhone.trim() || undefined,
          }),
        }),
      });

      if (!res.ok) {
        // POST /api/donations (and every other route in this app) returns
        // its reason as `{ error }`, never `{ message }` -- reading the
        // wrong key here meant the server's actual reason (e.g.
        // DONATIONS_DISABLED_MESSAGE) never reached the donor, only the
        // generic fallback below.
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal memproses donasi');
      }

      const data = await res.json();
      const redirectUrl: string | undefined = data?.paymentInstructions?.redirectUrl;

      if (redirectUrl) {
        // Hand the donor to the provider's payment page. Nothing has been
        // paid yet -- showing a success screen here and leaving them on it
        // would both lie and stop them completing the payment.
        window.location.assign(redirectUrl);
        return;
      }

      setCurrentStep(4);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Gagal memproses donasi');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Donations are off (donationsEnabled(), src/lib/donations.ts):
  // getPaymentProvider() only ever resolves to a mock that fabricates
  // payment instructions no bank issued and no donor can pay. Shown the
  // instant a donor lands on this page -- before the amount selector, the
  // payment method selector, or the confirmation step ever render, and
  // before the loading/error branches below, since this does not depend on
  // the campaign having loaded at all. Nobody should be invited to fill in
  // an amount only to discover at submit time that it can't go through.
  if (!donationsEnabled()) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-text-secondary">{DONATIONS_DISABLED_MESSAGE}</p>
        <button
          onClick={() => router.back()}
          className="text-primary font-medium hover:underline"
        >
          Kembali
        </button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-text-secondary">Memuat...</div>
      </div>
    );
  }

  // Error state. A 404 covers a missing slug and an unapproved Campaign the
  // viewer may not see (only its Fundraiser, Verifiers and Admins may), which
  // the API answers alike; nothing of the Campaign ever reaches this page.
  if (error || !campaign) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-text-secondary text-center">
          {notFound
            ? 'Campaign tidak ditemukan.'
            : 'Campaign tidak ditemukan atau terjadi kesalahan.'}
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

  // Only an effectively Active Campaign takes a Donation (POST
  // /api/donations refuses the rest). Someone who lands here by link on a
  // Suspended, Cancelled or ended Campaign is told why before any amount is
  // asked of them. A missing status counts as not Active.
  //
  // An Active one whose Collecting Entity cannot collect for it right now (it
  // names none, or holds no Fundraising Permit valid now for its Kind) is
  // refused by POST /api/donations too; the donor is told before any amount.
  if (!offersDonating(campaign.lifecycleStatus) || campaign.donationBlock) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-text-secondary">
          {offersDonating(campaign.lifecycleStatus)
            ? COLLECTING_ENTITY_REFUSAL
            : (statusBannerCopy(campaign.lifecycleStatus) ?? 'Campaign ini tidak menerima donasi.')}
        </p>
        <button
          onClick={() => router.push(`/campaign/${slug}`)}
          className="text-primary font-medium hover:underline"
        >
          Kembali ke Campaign
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
            {/* Demo campaign badge (task M9) -- this is the screen where the
                badge matters most: someone can land here directly, before
                ever seeing the card or detail page. Shown before the amount
                selector below, not after the 403 that would follow a
                submit. */}
            {campaign.isDemo && (
              <span className="inline-block bg-gray-800/90 text-white text-xs font-semibold px-2 py-0.5 rounded mb-1.5">
                Kampanye contoh — tidak menerima donasi sungguhan
              </span>
            )}
            <p className="text-xs text-text-secondary">Donasi untuk:</p>
            <p className="text-sm font-medium text-text line-clamp-1">
              {campaign.title}
            </p>
            {/* The Donor's legal counterparty is the Collecting Entity, not the platform (ADR 0010). */}
            {campaign.collectingEntity && (
              <p className="text-xs text-text-secondary mt-0.5">
                Dihimpun oleh {campaign.collectingEntity.name}
              </p>
            )}
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
              guestContact={
                isGuest
                  ? {
                      email: guestEmail,
                      name: guestName,
                      phone: guestPhone,
                      onEmailChange: (value) => {
                        setGuestEmail(value);
                        if (guestEmailError) setGuestEmailError(null);
                      },
                      onNameChange: setGuestName,
                      onPhoneChange: setGuestPhone,
                      error: guestEmailError ?? undefined,
                    }
                  : undefined
              }
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
              <h2 className="text-xl font-bold text-text">Donasi Dibuat</h2>
              <p className="text-text-secondary text-sm">
                Selesaikan pembayaran agar donasimu tersalurkan
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
