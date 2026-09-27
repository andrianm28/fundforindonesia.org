import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReceiptView } from './ReceiptView';

/**
 * The Receipt print page (CONTEXT.md, Receipt): names the Collecting Entity
 * as who received the money, can be printed, and lets the Donor ask for the
 * email again without needing an account.
 */

function baseProps() {
  return {
    token: 'tok-1',
    campaignTitle: 'Bantu Sekolah Yatim',
    collectingEntityName: 'Yayasan Insan Ekonomi Mandiri',
    amount: 250_000,
    paidAt: '2026-09-26T10:00:00.000Z',
    donorName: 'Sari',
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReceiptView', () => {
  it('shows the Collecting Entity as who received the money, never the platform', () => {
    render(<ReceiptView {...baseProps()} />);

    expect(screen.getByText('Yayasan Insan Ekonomi Mandiri')).toBeTruthy();
  });

  it('shows the Campaign, amount and Donor name', () => {
    render(<ReceiptView {...baseProps()} />);

    expect(screen.getByText('Bantu Sekolah Yatim')).toBeTruthy();
    expect(screen.getByText('Rp250.000')).toBeTruthy();
    expect(screen.getByText('Sari')).toBeTruthy();
  });

  it('prints the page when Cetak is clicked', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<ReceiptView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cetak' }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('resends the Receipt email and shows a confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sent: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ReceiptView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang ke email' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/receipts/tok-1/resend', { method: 'POST' });
    await waitFor(() => expect(screen.getByText(/terkirim/i)).toBeTruthy());
  });

  it('shows an error message when the resend is refused (e.g. cooldown)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Mohon tunggu' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ReceiptView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang ke email' }));

    await waitFor(() => expect(screen.getByText('Mohon tunggu')).toBeTruthy());
  });
});
