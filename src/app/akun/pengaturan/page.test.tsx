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
