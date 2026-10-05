import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const params = vi.hoisted(() => ({ token: 'tok.abc' as string | null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'token' ? params.token : null) }),
}));
vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, type, disabled, onClick }: React.ComponentProps<'button'>) => (
      <button type={type} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));

import ResetPasswordPage from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  params.token = 'tok.abc';
});

function fill(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(/^password baru/i), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/konfirmasi password/i), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: /simpan password/i }));
}

describe('Reset Password page', () => {
  it('posts the token and the new password only when the form is submitted, then links to login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ResetPasswordPage />);
    expect(fetchMock).not.toHaveBeenCalled();
    fill('password-baru-123', 'password-baru-123');

    await waitFor(() => expect(screen.getByText(/password berhasil diubah/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/confirm',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'tok.abc', password: 'password-baru-123' }) }),
    );
    expect(screen.getByRole('link', { name: /masuk/i })).toHaveAttribute('href', '/login');
  });

  it('does not post when the confirmation differs', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ResetPasswordPage />);
    fill('password-baru-123', 'password-lain-456');

    expect(screen.getByRole('alert')).toHaveTextContent(/konfirmasi password tidak cocok/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not post a password shorter than 8 characters', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ResetPasswordPage />);
    fill('short', 'short');

    expect(screen.getByRole('alert')).toHaveTextContent(/minimal 8 karakter/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the link is not valid and offers a new one when the server refuses the token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru dari halaman Lupa Password.' }) }));

    render(<ResetPasswordPage />);
    fill('password-baru-123', 'password-baru-123');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/tidak valid atau sudah kedaluwarsa/i));
    expect(screen.getByRole('link', { name: /minta tautan baru/i })).toHaveAttribute('href', '/lupa-password');
  });

  it('shows the schema message when the server refuses the password', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Validasi gagal', errors: { password: 'Password maksimal 72 byte' } }) }));

    render(<ResetPasswordPage />);
    fill('password-baru-123', 'password-baru-123');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/maksimal 72 byte/i));
  });

  it('offers no form when the link carries no token', () => {
    params.token = null;

    render(<ResetPasswordPage />);

    expect(screen.queryByRole('button', { name: /simpan password/i })).toBeNull();
    expect(screen.getByText(/tautan tidak lengkap/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /minta tautan baru/i })).toHaveAttribute('href', '/lupa-password');
  });
});
