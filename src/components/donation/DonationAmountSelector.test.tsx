import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DonationAmountSelector } from './DonationAmountSelector';

afterEach(() => {
  cleanup();
});

const defaultProps = {
  presets: [10000, 25000, 50000, 100000, 500000],
  minAmount: 1000,
  maxAmount: 1000000000,
  selectedAmount: null,
  onAmountChange: vi.fn(),
  onNext: vi.fn(),
};

describe('DonationAmountSelector', () => {
  it('renders all preset amount buttons', () => {
    render(<DonationAmountSelector {...defaultProps} />);
    expect(screen.getByText('Rp10.000')).toBeInTheDocument();
    expect(screen.getByText('Rp25.000')).toBeInTheDocument();
    expect(screen.getByText('Rp50.000')).toBeInTheDocument();
    expect(screen.getByText('Rp100.000')).toBeInTheDocument();
    expect(screen.getByText('Rp500.000')).toBeInTheDocument();
  });

  it('renders the custom input with Rp prefix', () => {
    render(<DonationAmountSelector {...defaultProps} />);
    expect(screen.getByText('Rp')).toBeInTheDocument();
    expect(screen.getByLabelText('Nominal donasi custom')).toBeInTheDocument();
  });

  it('renders the Lanjutkan button', () => {
    render(<DonationAmountSelector {...defaultProps} />);
    expect(screen.getByRole('button', { name: /lanjutkan/i })).toBeInTheDocument();
  });

  it('disables Next button when no amount is selected', () => {
    render(<DonationAmountSelector {...defaultProps} selectedAmount={null} />);
    expect(screen.getByRole('button', { name: /lanjutkan/i })).toBeDisabled();
  });

  it('disables Next button when amount is below minimum', () => {
    render(<DonationAmountSelector {...defaultProps} selectedAmount={500} />);
    expect(screen.getByRole('button', { name: /lanjutkan/i })).toBeDisabled();
  });

  it('disables Next button when amount is above maximum', () => {
    render(
      <DonationAmountSelector {...defaultProps} maxAmount={100000} selectedAmount={200000} />
    );
    expect(screen.getByRole('button', { name: /lanjutkan/i })).toBeDisabled();
  });

  it('enables Next button when valid amount is selected', () => {
    render(<DonationAmountSelector {...defaultProps} selectedAmount={50000} />);
    expect(screen.getByRole('button', { name: /lanjutkan/i })).not.toBeDisabled();
  });

  it('calls onAmountChange when a preset button is clicked', () => {
    const onAmountChange = vi.fn();
    render(<DonationAmountSelector {...defaultProps} onAmountChange={onAmountChange} />);
    fireEvent.click(screen.getByText('Rp50.000'));
    expect(onAmountChange).toHaveBeenCalledWith(50000);
  });

  it('calls onNext when Lanjutkan is clicked with valid amount', () => {
    const onNext = vi.fn();
    render(<DonationAmountSelector {...defaultProps} selectedAmount={25000} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: /lanjutkan/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('highlights selected preset button', () => {
    render(<DonationAmountSelector {...defaultProps} selectedAmount={25000} />);
    const selectedBtn = screen.getByText('Rp25.000');
    expect(selectedBtn).toHaveClass('border-primary');
    expect(selectedBtn).toHaveClass('bg-blue-50');
    expect(selectedBtn).toHaveClass('text-primary');
  });

  it('calls onAmountChange when typing in custom input', () => {
    const onAmountChange = vi.fn();
    render(<DonationAmountSelector {...defaultProps} onAmountChange={onAmountChange} />);
    const input = screen.getByLabelText('Nominal donasi custom');
    fireEvent.change(input, { target: { value: '75000' } });
    expect(onAmountChange).toHaveBeenCalledWith(75000);
  });

  it('formats custom input with thousand separators', () => {
    render(<DonationAmountSelector {...defaultProps} />);
    const input = screen.getByLabelText('Nominal donasi custom') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1500000' } });
    expect(input.value).toBe('1.500.000');
  });

  it('displays error message when amount is below minimum', () => {
    render(<DonationAmountSelector {...defaultProps} selectedAmount={500} />);
    // Focus custom input to activate custom mode and show error
    const input = screen.getByLabelText('Nominal donasi custom');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '500' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Minimum donasi Rp1.000');
  });

  it('displays custom error from props', () => {
    render(<DonationAmountSelector {...defaultProps} selectedAmount={500} error="Custom error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Custom error');
  });

  it('has proper aria-pressed on selected preset', () => {
    render(<DonationAmountSelector {...defaultProps} selectedAmount={100000} />);
    const selectedBtn = screen.getByLabelText('Donasi Rp100.000');
    expect(selectedBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('strips non-numeric characters from custom input', () => {
    const onAmountChange = vi.fn();
    render(<DonationAmountSelector {...defaultProps} onAmountChange={onAmountChange} />);
    const input = screen.getByLabelText('Nominal donasi custom');
    fireEvent.change(input, { target: { value: 'abc123xyz' } });
    expect(onAmountChange).toHaveBeenCalledWith(123);
  });
});
