import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ZakatPage from './page';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('ZakatPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders the zakat page with type selectors', () => {
    render(<ZakatPage />);
    expect(screen.getByText('Zakat & Donasi')).toBeInTheDocument();
    expect(screen.getAllByText('Zakat Mal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Zakat Fitrah').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Infaq').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sedekah').length).toBeGreaterThan(0);
  });

  it('shows Zakat Mal calculator by default with nisab info', () => {
    render(<ZakatPage />);
    expect(screen.getAllByText('Kalkulator Zakat Mal').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Nisab/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rp85.000.000').length).toBeGreaterThan(0);
  });

  it('calculates Zakat Mal correctly when assets exceed nisab', () => {
    render(<ZakatPage />);

    const inputs = screen.getAllByPlaceholderText('0');
    fireEvent.change(inputs[0], { target: { value: '100000000' } });

    expect(screen.getByText('Wajib Zakat')).toBeInTheDocument();
    // 2.5% of (100M - 85M) = 375,000
    expect(screen.getByText('Rp375.000')).toBeInTheDocument();
  });

  it('shows "Belum mencapai nisab" when assets below threshold', () => {
    render(<ZakatPage />);

    const inputs = screen.getAllByPlaceholderText('0');
    fireEvent.change(inputs[0], { target: { value: '50000000' } });

    expect(screen.getByText('Belum mencapai nisab')).toBeInTheDocument();
  });

  it('switches to Zakat Fitrah calculator', () => {
    render(<ZakatPage />);

    const fitrahButtons = screen.getAllByText('Zakat Fitrah');
    fireEvent.click(fitrahButtons[0].closest('button')!);

    expect(screen.getAllByText('Kalkulator Zakat Fitrah').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rp35.000 / jiwa').length).toBeGreaterThan(0);
  });

  it('calculates Zakat Fitrah for multiple people', () => {
    render(<ZakatPage />);

    const fitrahButtons = screen.getAllByText('Zakat Fitrah');
    fireEvent.click(fitrahButtons[0].closest('button')!);

    const addButton = screen.getByLabelText('Tambah jumlah jiwa');
    fireEvent.click(addButton);

    // 2 people * 35000 = 70000
    expect(screen.getByText('Rp70.000')).toBeInTheDocument();
  });

  it('switches to Infaq section with preset amounts', () => {
    render(<ZakatPage />);

    const infaqButtons = screen.getAllByText('Infaq');
    fireEvent.click(infaqButtons[0].closest('button')!);

    expect(screen.getByText('Salurkan infaq Anda untuk kebaikan umat')).toBeInTheDocument();
    expect(screen.getByText('Rp10.000')).toBeInTheDocument();
    expect(screen.getByText('Rp100.000')).toBeInTheDocument();
  });

  it('navigates to donation flow when Bayar Zakat is clicked', () => {
    const { container } = render(<ZakatPage />);

    // Enter assets exceeding nisab
    const inputs = container.querySelectorAll('input[placeholder="0"]');
    fireEvent.change(inputs[0], { target: { value: '100000000' } });

    // Find the pay button within our specific container
    const buttons = container.querySelectorAll('button');
    const payButton = Array.from(buttons).find(btn => {
      const text = btn.textContent || '';
      return text.includes('Bayar Zakat') && text.includes('375');
    });
    expect(payButton).toBeTruthy();
    fireEvent.click(payButton!);

    expect(mockPush).toHaveBeenCalledWith('/explore/all?category=zakat&amount=375000');
  });

  it('disables the Bayar Zakat button when amount is 0', () => {
    render(<ZakatPage />);

    const allButtons = screen.getAllByRole('button');
    const submitButton = allButtons.find(btn =>
      btn.textContent === 'Bayar Zakat' && btn.hasAttribute('disabled')
    );
    expect(submitButton).toBeTruthy();
    expect(submitButton).toBeDisabled();
  });
});
