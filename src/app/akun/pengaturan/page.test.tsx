import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signOut = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    update: vi.fn(),
    data: { user: { id: 'user-1', name: 'Budi', email: 'budi@test.com', assignments: [] }, expires: '2099-01-01' },
  }),
  signOut,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/account/AnonymiseDonationsSection', () => ({
  AnonymiseDonationsSection: () => null,
}));

import SettingsPage from './page';

// A new password ends every session issued under the old one, this one
// included (rilis-1 93, src/lib/auth.ts), so the page signs the person out
// shortly after the change instead of letting their next click fail silently.
function submitPasswordChange() {
  fireEvent.change(screen.getByLabelText('Password Saat Ini'), { target: { value: 'password-lama-1' } });
  fireEvent.change(screen.getByLabelText('Password Baru'), { target: { value: 'password-baru-123' } });
  fireEvent.change(screen.getByLabelText('Konfirmasi Password Baru'), { target: { value: 'password-baru-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ubah Password' }));
}

async function flushRequest() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Settings page, password change', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    signOut.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('says the password changed and signs the person out to /login after 1.5 seconds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    render(<SettingsPage />);
    submitPasswordChange();
    await flushRequest();

    expect(screen.getByText(/password berhasil diubah\. silakan masuk lagi/i)).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });

  it('does not sign out when the change is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Password saat ini salah' }) }),
    );

    render(<SettingsPage />);
    submitPasswordChange();
    await flushRequest();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('Password saat ini salah')).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('does not sign out after the page was left before the timer ran', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const { unmount } = render(<SettingsPage />);
    submitPasswordChange();
    await flushRequest();
    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(signOut).not.toHaveBeenCalled();
  });
});

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
