import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import LupaPasswordPage from './page';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Lupa Password page', () => {
  it('asks for an email and posts it to the reset endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<LupaPasswordPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sari@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /kirim tautan/i }));

    await waitFor(() => expect(screen.getByText(/jika email itu terdaftar/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'sari@example.test' }) }),
    );
  });

  it('shows the same confirmation whatever the server knows about the address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    render(<LupaPasswordPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'nobody@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /kirim tautan/i }));

    await waitFor(() => expect(screen.getByText(/jika email itu terdaftar/i)).toBeInTheDocument());
  });

  it('does not post an address that is not an email', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<LupaPasswordPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /kirim tautan/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/format email tidak valid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server message when the requests are limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Terlalu banyak permintaan atur ulang password. Coba lagi nanti.' }) }));

    render(<LupaPasswordPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sari@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /kirim tautan/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/terlalu banyak permintaan/i));
  });

  it('links back to the login page', () => {
    render(<LupaPasswordPage />);

    expect(screen.getByRole('link', { name: /kembali ke halaman masuk/i })).toHaveAttribute('href', '/login');
  });
});
