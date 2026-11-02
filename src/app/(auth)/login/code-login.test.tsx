import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import LoginPage from './page';

/**
 * Sign-in by mailed code is what /login shows first: the address, then the
 * 6-digit code, then back to where the visitor came from.
 */

const mockSignIn = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  getProviders: () => Promise.resolve({}),
}));
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('framer-motion', () => ({
  motion: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    button: ({ children, whileTap: _w, transition: _t, ...props }: any) => <button {...props}>{children}</button>,
  },
}));

const fetchMock = vi.fn();

function okResponse(message = 'Jika email ini terdaftar, kode masuk sudah kami kirim.') {
  return { ok: true, status: 200, json: async () => ({ message }) };
}

async function toCodeStep(email = 'sari@example.test') {
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /kirim kode/i }));
  return screen.findByLabelText(/kode masuk/i);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(okResponse());
  mockSignIn.mockResolvedValue({ ok: true, error: null });
  window.history.replaceState(null, '', '/login');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('LoginPage, sign-in by code', () => {
  it('asks only for an email first, with no password field', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /kirim kode/i })).toBeInTheDocument();
  });

  it('validates the address before asking for a code', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /kirim kode/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email harus diisi');

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'bukan-email' } });
    fireEvent.click(screen.getByRole('button', { name: /kirim kode/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Format email tidak valid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the server for a code and moves to the code step', async () => {
    await toCodeStep(' sari@example.test ');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login-code', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'sari@example.test' });
    expect(screen.getByRole('status')).toHaveTextContent('sari@example.test');
  });

  it('shows the server refusal and stays on the email step', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ message: 'Terlalu banyak permintaan kode masuk.' }) });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sari@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /kirim kode/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Terlalu banyak permintaan kode masuk.');
    expect(screen.queryByLabelText(/kode masuk/i)).not.toBeInTheDocument();
  });

  it('signs in with the code and returns to the callback page', async () => {
    window.history.replaceState(null, '', '/login?callbackUrl=%2Fdonasi-saya');
    const input = await toCodeStep();

    fireEvent.change(input, { target: { value: '123 456' } });
    fireEvent.click(screen.getByRole('button', { name: /^masuk$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/donasi-saya'));
    expect(mockSignIn).toHaveBeenCalledWith('email-otp', { email: 'sari@example.test', code: '123456', redirect: false });
  });

  it('refuses a code that is not 6 digits without calling sign-in', async () => {
    const input = await toCodeStep();

    fireEvent.change(input, { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: /^masuk$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('6 digit');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('says the code is wrong or expired when sign-in fails', async () => {
    mockSignIn.mockResolvedValue({ ok: false, error: 'Kode salah atau sudah tidak berlaku' });
    const input = await toCodeStep();

    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /^masuk$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Kode salah atau sudah tidak berlaku');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('holds the resend button during the cooldown', async () => {
    await toCodeStep();
    expect(screen.getByRole('button', { name: /kirim ulang/i })).toBeDisabled();
  });

  it('can go back and change the address', async () => {
    await toCodeStep();
    fireEvent.click(screen.getByRole('button', { name: /ganti email/i }));
    expect(screen.getByRole('button', { name: /kirim kode/i })).toBeInTheDocument();
  });
});
