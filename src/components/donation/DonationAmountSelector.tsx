'use client';

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { formatRupiah } from '@/lib/utils/currency';
import { Button } from '@/components/ui/Button';

export interface DonationAmountSelectorProps {
  presets: number[];
  minAmount: number;
  maxAmount: number;
  selectedAmount: number | null;
  onAmountChange: (amount: number) => void;
  onNext: () => void;
  error?: string;
}

function formatThousandSeparator(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseFormattedInput(value: string): number {
  const digits = value.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

export function DonationAmountSelector({
  presets,
  minAmount,
  maxAmount,
  selectedAmount,
  onAmountChange,
  onNext,
  error,
}: DonationAmountSelectorProps) {
  const [customInput, setCustomInput] = useState('');
  const [isCustomActive, setIsCustomActive] = useState(false);

  const isAmountValid =
    selectedAmount !== null &&
    selectedAmount >= minAmount &&
    selectedAmount <= maxAmount;

  const validationError = (() => {
    if (error) return error;
    if (selectedAmount === null) return undefined;
    if (selectedAmount < minAmount) {
      return `Minimum donasi ${formatRupiah(minAmount)}`;
    }
    if (selectedAmount > maxAmount) {
      return `Maksimum donasi ${formatRupiah(maxAmount)}`;
    }
    return undefined;
  })();

  const handlePresetClick = useCallback(
    (amount: number) => {
      setIsCustomActive(false);
      setCustomInput('');
      onAmountChange(amount);
    },
    [onAmountChange]
  );

  const handleCustomInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value;
      const numericValue = parseFormattedInput(rawValue);
      const formatted = numericValue > 0 ? formatThousandSeparator(numericValue.toString()) : '';

      setCustomInput(formatted);
      setIsCustomActive(true);

      if (numericValue > 0) {
        onAmountChange(numericValue);
      }
    },
    [onAmountChange]
  );

  const handleCustomInputFocus = useCallback(() => {
    setIsCustomActive(true);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Preset Amount Buttons */}
      <div>
        <p className="text-sm text-text-secondary mb-3 font-medium">
          Pilih nominal donasi
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {presets.map((amount) => {
            const isSelected = !isCustomActive && selectedAmount === amount;
            return (
              <motion.button
                key={amount}
                type="button"
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                onClick={() => handlePresetClick(amount)}
                className={[
                  'py-3 px-4 rounded-md text-sm font-semibold transition-colors duration-fast',
                  'border-2 focus:outline-hidden focus:ring-2 focus:ring-primary/30',
                  isSelected
                    ? 'border-primary bg-blue-50 text-primary'
                    : 'border-border bg-white text-text hover:border-primary/50 hover:bg-blue-50/50',
                ].join(' ')}
                aria-pressed={isSelected}
                aria-label={`Donasi ${formatRupiah(amount)}`}
              >
                {formatRupiah(amount)}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Custom Amount Input */}
      <div>
        <p className="text-sm text-text-secondary mb-2 font-medium">
          Atau masukkan nominal lain
        </p>
        <div
          className={[
            'flex items-center border-2 rounded-md overflow-hidden transition-colors duration-fast',
            isCustomActive && !validationError
              ? 'border-primary'
              : validationError && isCustomActive
              ? 'border-danger'
              : 'border-border',
          ].join(' ')}
        >
          <span className="px-3 py-3 bg-bg-secondary text-text-secondary font-semibold text-sm border-r border-border">
            Rp
          </span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Masukkan nominal"
            value={customInput}
            onChange={handleCustomInputChange}
            onFocus={handleCustomInputFocus}
            className="flex-1 px-3 py-3 text-sm text-text outline-hidden bg-white placeholder:text-text-secondary/50"
            aria-label="Nominal donasi custom"
            aria-invalid={!!validationError && isCustomActive}
            aria-describedby={validationError ? 'donation-error' : undefined}
          />
        </div>
        {validationError && (
          <p
            id="donation-error"
            className="mt-2 text-xs text-danger"
            role="alert"
          >
            {validationError}
          </p>
        )}
      </div>

      {/* Next Button */}
      <Button
        variant="primary"
        size="full"
        onClick={onNext}
        disabled={!isAmountValid}
      >
        Lanjutkan
      </Button>
    </div>
  );
}

export default DonationAmountSelector;
