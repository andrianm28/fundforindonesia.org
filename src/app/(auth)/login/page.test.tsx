import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import LoginPage from './page';

// Mock next-auth/react
const mockSignIn = vi.fn();
const mockGetProviders = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  getProviders: () => mockGetProviders(),
}));

const CREDENTIALS_ONLY = { 'email-otp': { id: 'email-otp', name: 'email-otp' } };
const WITH_GOOGLE = { ...CREDENTIALS_ONLY, google: { id: 'google', name: 'Google' } };

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    button: ({
      children,
      whileTap: _whileTap,
      transition: _transition,
      ...props
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  beforeEach(() => {
    mockSignIn.mockResolvedValue({ ok: false, error: null });
    mockGetProviders.mockResolvedValue(WITH_GOOGLE);
  });

  it('shows only the email code form: no password field, toggle or forgot-password link', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /masuk dengan password/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /lupa password/i })).not.toBeInTheDocument();
  });

  it('renders Google OAuth button when Google is configured', async () => {
    render(<LoginPage />);
    expect(await screen.findByRole('button', { name: /masuk dengan google/i })).toBeInTheDocument();
  });

  it('hides the Google button and the separator when Google is not configured', async () => {
    mockGetProviders.mockResolvedValue(CREDENTIALS_ONLY);
    render(<LoginPage />);
    await waitFor(() => expect(mockGetProviders).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /masuk dengan google/i })).not.toBeInTheDocument();
    expect(screen.queryByText('atau')).not.toBeInTheDocument();
  });

  it('keeps the Google button hidden when the providers request fails', async () => {
    mockGetProviders.mockRejectedValue(new Error('network'));
    render(<LoginPage />);
    await waitFor(() => expect(mockGetProviders).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /masuk dengan google/i })).not.toBeInTheDocument();
  });

  it('renders link to register page', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /daftar di sini/i })).toHaveAttribute('href', '/register');
  });

  it('carries ?callbackUrl through Google sign-in', async () => {
    window.history.pushState({}, '', '/login?callbackUrl=%2Fvolunteer-trip%2Fmengajar');
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: /masuk dengan google/i }));
    expect(mockSignIn).toHaveBeenCalledWith('google', { callbackUrl: '/volunteer-trip/mengajar' });
    window.history.pushState({}, '', '/');
  });

  it('calls signIn with google provider when Google button is clicked', async () => {
    render(<LoginPage />);
    fireEvent.click(await screen.findByRole('button', { name: /masuk dengan google/i }));
    expect(mockSignIn).toHaveBeenCalledWith('google', { callbackUrl: '/' });
  });
});

describe('LoginPage, ?error=OperatorCodeOnly', () => {
  beforeEach(() => {
    mockGetProviders.mockResolvedValue(WITH_GOOGLE);
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  it('tells an Admin or Verifier turned away from Google to use the email code', async () => {
    window.history.pushState({}, '', '/login?error=OperatorCodeOnly');
    render(<LoginPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Akun Admin/Verifier masuk dengan kode email.');
  });

  it('shows no message without that error', () => {
    render(<LoginPage />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('LoginPage consent line (audit L3)', () => {
  it('links the Terms and Privacy policy under the form', () => {
    mockGetProviders.mockResolvedValue(CREDENTIALS_ONLY);
    render(<LoginPage />);
    expect(screen.getByText(/Dengan masuk, Anda menyetujui/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Syarat & Ketentuan/ })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Kebijakan Privasi' })).toHaveAttribute('href', '/privacy');
  });
});
