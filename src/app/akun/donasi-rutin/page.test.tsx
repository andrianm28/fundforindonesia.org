import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const search = vi.hoisted(() => ({ value: 'campaign=camp-1' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search.value) }));

import DonasiRutinPage from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  search.value = 'campaign=camp-1';
});

function respond(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

describe('akun/donasi-rutin registration (PKS 4.7)', () => {
  it('shows the Campaign title, asks for no id, and registers with the hidden id', async () => {
    const fetchMock = respond({ recurringDonations: [], campaign: { id: 'camp-1', title: 'Sumur untuk Desa' } });
    vi.stubGlobal('fetch', fetchMock);

    render(<DonasiRutinPage />);

    expect(await screen.findByText('Sumur untuk Desa')).toBeInTheDocument();
    expect(screen.queryByLabelText(/ID Campaign/i)).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/donasi-rutin?campaign=camp-1');

    fireEvent.click(screen.getByRole('button', { name: 'Daftarkan' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body).campaignId).toBe('camp-1');
  });

  it('offers no form, and says so, when the Campaign cannot take recurring donations', async () => {
    vi.stubGlobal('fetch', respond({ recurringDonations: [], campaign: null }));
    render(<DonasiRutinPage />);
    expect(await screen.findByText(/tidak dapat menerima donasi rutin/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Daftarkan' })).toBeNull();
  });

  it('points to the Campaign pages when opened without a Campaign', async () => {
    search.value = '';
    vi.stubGlobal('fetch', respond({ recurringDonations: [] }));
    render(<DonasiRutinPage />);
    expect(await screen.findByText(/buka halaman Campaign/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Daftarkan' })).toBeNull();
  });
});
