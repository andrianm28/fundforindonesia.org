import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AdminZakatSettingsForm } from './AdminZakatSettingsForm';

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const ORGS = [
  { id: 'org-1', name: 'Yayasan Contoh Peduli' },
  { id: 'org-2', name: 'Lembaga Amil Contoh' },
];
const OFF = { enabled: false, nisabAmount: 0, recipientOrganisationId: null };

function mockFetch(response: { ok: boolean; status: number; body?: unknown }) {
  const fn = vi.fn().mockResolvedValue({ ok: response.ok, status: response.status, json: async () => response.body ?? {} });
  global.fetch = fn as never;
  return fn;
}

describe('AdminZakatSettingsForm', () => {
  it('states that the module is off and names the legal prerequisites before it may be turned on', () => {
    render(<AdminZakatSettingsForm initial={OFF} organisations={ORGS} />);

    expect(screen.getByLabelText('Aktifkan modul zakat')).not.toBeChecked();
    expect(screen.getByText(/dasar legal/i)).toBeDefined();
    expect(screen.getByText(/Pasal 12 ayat 2/)).toBeDefined();
  });

  it('sends only what the Admin changed: nisab as whole rupiah, the recipient, and the switch', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 });
    render(<AdminZakatSettingsForm initial={OFF} organisations={ORGS} />);

    fireEvent.change(screen.getByLabelText('Nisab tahunan (Rp)'), { target: { value: '85.000.000' } });
    fireEvent.change(screen.getByLabelText('Lembaga penerima zakat'), { target: { value: 'org-1' } });
    fireEvent.click(screen.getByLabelText('Aktifkan modul zakat'));
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/operations');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      zakatNisabAmount: 85_000_000,
      zakatRecipientOrganisationId: 'org-1',
      zakatEnabled: true,
    });
  });

  it('shows the server refusal, for instance a recipient without a zakat licence', async () => {
    const message = 'Penanda zakat hanya bisa dihidupkan bila lembaga penerima memegang izin.';
    mockFetch({ ok: false, status: 400, body: { error: message } });
    render(<AdminZakatSettingsForm initial={OFF} organisations={ORGS} />);

    fireEvent.click(screen.getByLabelText('Aktifkan modul zakat'));
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });

  it('does not offer Simpan until something changed', () => {
    render(<AdminZakatSettingsForm initial={OFF} organisations={ORGS} />);
    expect(screen.getByRole('button', { name: /simpan/i })).toBeDisabled();
  });
});
