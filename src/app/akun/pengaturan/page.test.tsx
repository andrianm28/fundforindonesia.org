import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    update: vi.fn(),
    data: { user: { id: 'user-1', name: 'Budi', email: 'budi@test.com', assignments: [] }, expires: '2099-01-01' },
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/account/AnonymiseDonationsSection', () => ({
  AnonymiseDonationsSection: () => null,
}));

import SettingsPage from './page';

describe('Settings page, WhatsApp and profile type (PKS 3.1)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the saved number and saves a changed one through the profile API', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => ({
      ok: true,
      json: async () =>
        init?.method === 'PATCH'
          ? { user: { whatsapp: '6281299998888', profileType: 'ORGANISATION' } }
          : { user: { whatsapp: '6281234567890', profileType: 'INDIVIDUAL' } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsPage />);
    const input = (await screen.findByDisplayValue('+6281234567890')) as HTMLInputElement;

    fireEvent.change(input, { target: { value: '0812 9999 8888' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Lembaga' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    expect(await screen.findByText('Berhasil disimpan')).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body!)).toEqual({ whatsapp: '0812 9999 8888', profileType: 'ORGANISATION' });
  });

  it('shows the server message when the number is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { method?: string }) => ({
        ok: init?.method !== 'PATCH',
        json: async () =>
          init?.method === 'PATCH' ? { error: 'Validasi gagal', fieldErrors: { whatsapp: ['Nomor WhatsApp tidak valid.'] } } : {},
      })),
    );
    render(<SettingsPage />);
    fireEvent.change(screen.getByLabelText(/Nomor WhatsApp/), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Nomor WhatsApp tidak valid.')).toBeInTheDocument();
  });
});
