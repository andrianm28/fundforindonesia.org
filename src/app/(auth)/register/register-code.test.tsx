import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import RegisterPage from './page';

/**
 * Registering asks for a name and an address, no password: the account is
 * signed in by the first code mailed to it, which also proves the address.
 */

const mockSignIn = vi.fn();
vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => mockSignIn(...args) }));
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/auth/register'
      ? { ok: true, status: 201, json: async () => ({ message: 'Registrasi berhasil' }) }
      : { ok: true, status: 200, json: async () => ({ message: 'ok' }) },
  );
  mockSignIn.mockResolvedValue({ ok: true, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('RegisterPage, sign-in by code', () => {
  it('says the code was not sent when the request was refused, and allows a resend at once', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/auth/register'
        ? { ok: true, status: 201, json: async () => ({ message: 'Registrasi berhasil' }) }
        : { ok: false, status: 429, json: async () => ({ message: 'Terlalu banyak' }) },
    );
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/nama lengkap/i), { target: { value: 'Sari' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sari@example.test' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Syarat Layanan/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Kebijakan Privasi/ }));
    fireEvent.click(screen.getByRole('button', { name: /daftar/i }));

    await screen.findByLabelText(/kode masuk/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/belum terkirim/i);
    expect(screen.getByRole('button', { name: /kirim ulang kode/i })).not.toBeDisabled();
  });

  it('has no password field', () => {
    render(<RegisterPage />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('creates the account, mails a code, and signs in with it', async () => {
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/nama lengkap/i), { target: { value: 'Sari' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sari@example.test' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Syarat Layanan/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Kebijakan Privasi/ }));
    fireEvent.click(screen.getByRole('button', { name: /daftar/i }));

    const input = await screen.findByLabelText(/kode masuk/i);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'Sari',
      email: 'sari@example.test',
      whatsapp: '',
      profileType: 'INDIVIDUAL',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/login-code');

    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^masuk$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/'));
    expect(mockSignIn).toHaveBeenCalledWith('email-otp', { email: 'sari@example.test', code: '123456', redirect: false });
  });
});
