import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { ZakatCalculator } from './ZakatCalculator';

afterEach(cleanup);

const props = { nisabAmount: 85_000_000, campaignSlug: 'zakat-yayasan' as string | null, recipientName: 'Yayasan Contoh Peduli' };
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ZakatCalculator', () => {
  it('works out zakat penghasilan at 2.5% above the monthly nisab and offers it as the amount to pay', () => {
    render(<ZakatCalculator {...props} />);

    type('Penghasilan per bulan (Rp)', '10.000.000');
    type('Penghasilan lain per bulan (Rp)', '2000000');

    expect(screen.getByTestId('zakat-result').textContent).toMatch(/Rp300\.000/);
    expect(screen.getByRole('link', { name: /lanjut ke pembayaran/i }).getAttribute('href')).toBe(
      '/campaign/zakat-yayasan/donate?jumlah=300000',
    );
  });

  it('says nothing is owed below the nisab, and still lets the payer type an amount by hand', () => {
    render(<ZakatCalculator {...props} />);

    type('Penghasilan per bulan (Rp)', '5000000');
    expect(screen.getByTestId('zakat-result').textContent).toMatch(/belum mencapai nisab/i);

    type('Nominal zakat yang ingin dibayar (Rp)', '150.000');
    expect(screen.getByRole('link', { name: /lanjut ke pembayaran/i }).getAttribute('href')).toBe(
      '/campaign/zakat-yayasan/donate?jumlah=150000',
    );
  });

  it('works out zakat maal on net wealth against the yearly nisab', () => {
    render(<ZakatCalculator {...props} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Zakat maal' }));
    type('Tabungan (Rp)', '90000000');
    type('Emas dan investasi (Rp)', '30000000');
    type('Utang jatuh tempo (Rp)', '20000000');

    expect(screen.getByTestId('zakat-result').textContent).toMatch(/Rp2\.500\.000/);
    expect(screen.getByText(/satu tahun/i)).toBeDefined();
  });

  it('refuses a manual amount that is not whole rupiah: the pay link stays off', () => {
    render(<ZakatCalculator {...props} />);

    type('Nominal zakat yang ingin dibayar (Rp)', '12,5');

    expect(screen.queryByRole('link', { name: /lanjut ke pembayaran/i })).toBeNull();
  });

  it('explains instead of offering a link when no zakat Campaign can collect right now', () => {
    render(<ZakatCalculator {...props} campaignSlug={null} />);

    type('Nominal zakat yang ingin dibayar (Rp)', '150000');

    expect(screen.queryByRole('link', { name: /lanjut ke pembayaran/i })).toBeNull();
    expect(screen.getByText(/belum bisa menerima pembayaran zakat/i)).toBeDefined();
  });

  it('names the recipient and claims no sharia certification', () => {
    const { container } = render(<ZakatCalculator {...props} />);

    expect(container.textContent).toContain('Yayasan Contoh Peduli');
    expect(container.textContent).not.toMatch(/tersertifikasi|bersertifikat|sertifikasi syariah|dijamin syariah/i);
  });
});
