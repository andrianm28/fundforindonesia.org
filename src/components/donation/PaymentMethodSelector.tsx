'use client';

import { formatRupiah } from '@/lib/utils/currency';

import type { PaymentMethodType } from '@/types/donation';

export interface PaymentMethod {
  id: string;
  name: string;
  type: PaymentMethodType;
  icon: string;
  fee: number;
  instructions?: string;
}

export interface PaymentMethodSelectorProps {
  methods: PaymentMethod[];
  selectedMethod: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
  onNext: () => void;
}

const TYPE_LABELS: Record<PaymentMethodType, string> = {
  qris: 'QRIS',
  bank_transfer: 'Transfer Bank',
  ewallet: 'E-Wallet',
  credit_card: 'Kartu Kredit',
};

const TYPE_ORDER: PaymentMethodType[] = ['qris', 'bank_transfer', 'ewallet', 'credit_card'];

function groupMethodsByType(methods: PaymentMethod[]): Map<PaymentMethod['type'], PaymentMethod[]> {
  const grouped = new Map<PaymentMethod['type'], PaymentMethod[]>();
  for (const method of methods) {
    const existing = grouped.get(method.type) || [];
    existing.push(method);
    grouped.set(method.type, existing);
  }
  return grouped;
}

export function PaymentMethodSelector({
  methods,
  selectedMethod,
  onSelect,
  onNext,
}: PaymentMethodSelectorProps) {
  const grouped = groupMethodsByType(methods);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">Pilih Metode Pembayaran</h2>

      {TYPE_ORDER.map((type) => {
        const group = grouped.get(type);
        if (!group || group.length === 0) return null;

        return (
          <section key={type} aria-labelledby={`payment-group-${type}`}>
            <h3
              id={`payment-group-${type}`}
              className="text-sm font-medium text-gray-500 mb-2"
            >
              {TYPE_LABELS[type]}
            </h3>
            <div className="flex flex-col gap-2">
              {group.map((method) => {
                const isSelected = selectedMethod?.id === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => onSelect(method)}
                    className={[
                      'flex items-center gap-3 p-3 rounded-lg border transition-colors duration-150',
                      'hover:bg-blue-50',
                      isSelected
                        ? 'border-primary bg-blue-50'
                        : 'border-gray-200 bg-white',
                    ].join(' ')}
                    aria-pressed={isSelected}
                  >
                    <span className="text-2xl shrink-0" aria-hidden="true">
                      {method.icon}
                    </span>
                    <div className="flex flex-col items-start text-left flex-1">
                      <span className="text-sm font-medium text-text">
                        {method.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        Biaya admin: {formatRupiah(method.fee)}
                      </span>
                    </div>
                    {isSelected && (
                      <svg
                        className="w-5 h-5 text-primary shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <button
        type="button"
        onClick={onNext}
        disabled={!selectedMethod}
        className={[
          'w-full mt-4 py-3 rounded-md font-medium text-base transition-colors duration-150',
          selectedMethod
            ? 'bg-primary text-white hover:bg-primary-dark'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed',
        ].join(' ')}
      >
        Lanjutkan
      </button>
    </div>
  );
}

export default PaymentMethodSelector;
