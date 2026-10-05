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
    anonymised: false,
    accountOwned: false,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReceiptView beta notice (ticket rilis-1-benda/92)', () => {
  it('says no real money moved when the server asks for it', () => {
    render(<ReceiptView {...baseProps()} betaSandbox />);

    expect(screen.getByTestId('beta-banner').textContent).toMatch(/tidak ada uang nyata/i);
  });

  it('shows nothing by default or when the server says it is not the beta', () => {
    const { rerender } = render(<ReceiptView {...baseProps()} />);
    expect(screen.queryByTestId('beta-banner')).toBeNull();

    rerender(<ReceiptView {...baseProps()} betaSandbox={false} />);
    expect(screen.queryByTestId('beta-banner')).toBeNull();
  });
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

describe('ReceiptView, anonymisation (ticket 36)', () => {
  it('asks for confirmation first, and sends nothing until the Donor confirms', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ReceiptView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas saya' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/tidak dapat dibatalkan/i)).toBeTruthy();
    expect(screen.getByText(/tidak dapat di-refund lewat sistem/i)).toBeTruthy();
  });

  it('says only this Donation is anonymised, never every Donation with the email', () => {
    render(<ReceiptView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas saya' }));

    expect(screen.queryByText(/semua donasi/i)).toBeNull();
    expect(screen.getByText(/hanya donasi ini/i)).toBeTruthy();
  });

  it('will not post until an email is typed', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ReceiptView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas saya' }));

    expect((screen.getByRole('button', { name: 'Ya, anonimkan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the anonymise route on confirm and shows the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'anonymised' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ReceiptView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas saya' }));
    fireEvent.change(screen.getByLabelText(/email yang dipakai/i), { target: { value: 'sari@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ya, anonimkan' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/receipts/tok-1/anonymise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sari@example.org' }),
    });
    await waitFor(() => expect(screen.getByText(/sudah dianonimkan/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Kirim ulang ke email' })).toBeNull();
  });

  it('shows the refusal, for instance an open Refund', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'Ada Refund yang belum selesai' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ReceiptView {...baseProps()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus identitas saya' }));
    fireEvent.change(screen.getByLabelText(/email yang dipakai/i), { target: { value: 'sari@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ya, anonimkan' }));

    await waitFor(() => expect(screen.getByText('Ada Refund yang belum selesai')).toBeTruthy());
  });

  it('for an already anonymised Donation shows "Donor anonim", no name, and no way to resend or ask again', () => {
    render(<ReceiptView {...baseProps()} anonymised donorName={null} />);

    expect(screen.getByText('Donor anonim')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hapus identitas saya' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kirim ulang ke email' })).toBeNull();
  });

  it('for a Donation on an account points to account settings instead of offering the token route', () => {
    render(<ReceiptView {...baseProps()} accountOwned />);

    expect(screen.queryByRole('button', { name: 'Hapus identitas saya' })).toBeNull();
    expect(screen.getByRole('link', { name: /Pengaturan/ }).getAttribute('href')).toBe('/akun/pengaturan');
  });
});
