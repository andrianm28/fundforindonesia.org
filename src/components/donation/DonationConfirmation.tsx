'use client';

import React from 'react';
import { Campaign } from '@/types/campaign';
import { PaymentMethod } from '@/types/donation';
import { formatRupiah } from '@/lib/utils/currency';
import { Button } from '@/components/ui/Button';

export interface DonationConfirmationProps {
  campaign: Campaign;
  amount: number;
  paymentMethod: PaymentMethod;
  prayer?: string;
  isAnonymous: boolean;
  onPrayerChange: (text: string) => void;
  onAnonymousToggle: (value: boolean) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  /**
   * Shown only for a Guest Donor (no session): email required, name and
   * phone optional, kept only for Receipt (CONTEXT.md, Guest Donor;
   * prd-compliance 18). Omitted entirely for a signed-in Donor, whose
   * contact details already exist on their account.
   */
  guestContact?: {
    email: string;
    name: string;
    phone: string;
    onEmailChange: (value: string) => void;
    onNameChange: (value: string) => void;
    onPhoneChange: (value: string) => void;
    error?: string;
  };
}

const PRAYER_MAX_LENGTH = 500;

export function DonationConfirmation({
  campaign,
  amount,
  paymentMethod,
  prayer = '',
  isAnonymous,
  onPrayerChange,
  onAnonymousToggle,
  onConfirm,
  isSubmitting,
  guestContact,
}: DonationConfirmationProps) {
  const fee = paymentMethod.fee;
  const total = amount + fee;

  const handlePrayerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (value.length <= PRAYER_MAX_LENGTH) {
      onPrayerChange(value);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Summary Section */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          Ringkasan Donasi
        </h3>

        <div className="space-y-2">
          <div className="flex justify-between items-start">
            <span className="text-sm text-text-secondary">Kampanye</span>
            <span className="text-sm font-medium text-text text-right max-w-[60%]">
              {campaign.title}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-text-secondary">Nominal Donasi</span>
            <span className="text-sm font-medium text-text">
              {formatRupiah(amount)}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-text-secondary">Metode Pembayaran</span>
            <span className="text-sm font-medium text-text">
              {paymentMethod.name}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-text-secondary">Biaya Layanan</span>
            <span className="text-sm font-medium text-text">
              {formatRupiah(fee)}
            </span>
          </div>

          <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
            <span className="text-sm font-semibold text-text">Total</span>
            <span className="text-base font-bold text-primary">
              {formatRupiah(total)}
            </span>
          </div>
        </div>
      </div>

      {/* Guest Donor contact details (CONTEXT.md, Guest Donor; prd-compliance
          18): shown only when there is no session. Email is required for a
          Receipt; name and phone are optional. */}
      {guestContact && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="guest-email" className="text-sm font-medium text-text">
              Email <span className="text-danger">*</span>
            </label>
            <input
              id="guest-email"
              type="email"
              required
              value={guestContact.email}
              onChange={(e) => guestContact.onEmailChange(e.target.value)}
              placeholder="email@contoh.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-text placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              aria-invalid={!!guestContact.error}
              aria-describedby={guestContact.error ? 'guest-email-error' : undefined}
            />
            {guestContact.error && (
              <p id="guest-email-error" className="text-xs text-danger" role="alert">
                {guestContact.error}
              </p>
            )}
            <p className="text-xs text-text-secondary">Untuk mengirim bukti donasi (Receipt).</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="guest-name" className="text-sm font-medium text-text">
              Nama (opsional)
            </label>
            <input
              id="guest-name"
              type="text"
              value={guestContact.name}
              onChange={(e) => guestContact.onNameChange(e.target.value)}
              placeholder="Nama Anda"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-text placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="guest-phone" className="text-sm font-medium text-text">
              Nomor telepon (opsional)
            </label>
            <input
              id="guest-phone"
              type="tel"
              value={guestContact.phone}
              onChange={(e) => guestContact.onPhoneChange(e.target.value)}
              placeholder="08xxxxxxxxxx"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-text placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* Anonymous Toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={isAnonymous}
          onChange={(e) => onAnonymousToggle(e.target.checked)}
          className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
        />
        <span className="text-sm text-text">
          Sembunyikan nama saya (donasi anonim)
        </span>
      </label>

      {/* Prayer Textarea */}
      <div className="space-y-1">
        <label htmlFor="prayer-textarea" className="text-sm font-medium text-text">
          Doa & Dukungan
        </label>
        <textarea
          id="prayer-textarea"
          value={prayer}
          onChange={handlePrayerChange}
          placeholder="Tulis doa atau harapanmu..."
          maxLength={PRAYER_MAX_LENGTH}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-text placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
        />
        <p className="text-xs text-text-secondary text-right">
          {prayer.length}/{PRAYER_MAX_LENGTH}
        </p>
      </div>

      {/* Confirm Button */}
      <Button
        variant="primary"
        size="full"
        isLoading={isSubmitting}
        disabled={isSubmitting}
        onClick={onConfirm}
      >
        Donasi Sekarang
      </Button>
    </div>
  );
}

export default DonationConfirmation;
