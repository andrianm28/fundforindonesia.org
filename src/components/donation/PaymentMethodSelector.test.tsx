import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PaymentMethodSelector, PaymentMethod } from './PaymentMethodSelector';

afterEach(() => {
  cleanup();
});

const mockMethods: PaymentMethod[] = [
  { id: 'bca', name: 'BCA Virtual Account', type: 'bank_transfer', icon: '🏦', fee: 2500 },
  { id: 'bni', name: 'BNI Virtual Account', type: 'bank_transfer', icon: '🏦', fee: 2500 },
  { id: 'gopay', name: 'GoPay', type: 'ewallet', icon: '💳', fee: 1000 },
  { id: 'ovo', name: 'OVO', type: 'ewallet', icon: '💳', fee: 1000 },
  { id: 'visa', name: 'Visa/Mastercard', type: 'credit_card', icon: '💎', fee: 5000 },
];

describe('PaymentMethodSelector', () => {
  it('renders all payment methods', () => {
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={null}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(screen.getByText('BCA Virtual Account')).toBeInTheDocument();
    expect(screen.getByText('BNI Virtual Account')).toBeInTheDocument();
    expect(screen.getByText('GoPay')).toBeInTheDocument();
    expect(screen.getByText('OVO')).toBeInTheDocument();
    expect(screen.getByText('Visa/Mastercard')).toBeInTheDocument();
  });

  it('groups methods by type with section headers', () => {
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={null}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(screen.getByText('Transfer Bank')).toBeInTheDocument();
    expect(screen.getByText('E-Wallet')).toBeInTheDocument();
    expect(screen.getByText('Kartu Kredit')).toBeInTheDocument();
  });

  it('displays fee information for each method', () => {
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={null}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    // BCA has fee 2500
    expect(screen.getAllByText('Biaya admin: Rp2.500').length).toBeGreaterThanOrEqual(1);
    // GoPay has fee 1000
    expect(screen.getAllByText('Biaya admin: Rp1.000').length).toBeGreaterThanOrEqual(1);
    // Visa has fee 5000
    expect(screen.getByText('Biaya admin: Rp5.000')).toBeInTheDocument();
  });

  it('calls onSelect when a method is clicked', () => {
    const onSelect = vi.fn();
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={null}
        onSelect={onSelect}
        onNext={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('GoPay'));
    expect(onSelect).toHaveBeenCalledWith(mockMethods[2]);
  });

  it('highlights the selected method', () => {
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={mockMethods[0]}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    const bcaButton = screen.getByText('BCA Virtual Account').closest('button');
    expect(bcaButton).toHaveClass('border-primary');
    expect(bcaButton).toHaveClass('bg-blue-50');
  });

  it('does not highlight unselected methods', () => {
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={mockMethods[0]}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    const gopayButton = screen.getByText('GoPay').closest('button');
    expect(gopayButton).toHaveClass('border-gray-200');
    expect(gopayButton).not.toHaveClass('border-primary');
  });

  it('disables Lanjutkan button when no method is selected', () => {
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={null}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    const button = screen.getByText('Lanjutkan');
    expect(button).toBeDisabled();
  });

  it('enables Lanjutkan button when a method is selected', () => {
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={mockMethods[0]}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    const button = screen.getByText('Lanjutkan');
    expect(button).not.toBeDisabled();
  });

  it('calls onNext when Lanjutkan button is clicked with a selected method', () => {
    const onNext = vi.fn();
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={mockMethods[0]}
        onSelect={vi.fn()}
        onNext={onNext}
      />
    );
    fireEvent.click(screen.getByText('Lanjutkan'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('does not render group section if no methods of that type exist', () => {
    const bankOnly: PaymentMethod[] = [
      { id: 'bca', name: 'BCA', type: 'bank_transfer', icon: '🏦', fee: 2500 },
    ];
    render(
      <PaymentMethodSelector
        methods={bankOnly}
        selectedMethod={null}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(screen.getByText('Transfer Bank')).toBeInTheDocument();
    expect(screen.queryByText('E-Wallet')).not.toBeInTheDocument();
    expect(screen.queryByText('Kartu Kredit')).not.toBeInTheDocument();
  });

  it('renders heading text', () => {
    render(
      <PaymentMethodSelector
        methods={mockMethods}
        selectedMethod={null}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />
    );
    expect(screen.getByText('Pilih Metode Pembayaran')).toBeInTheDocument();
  });
});
