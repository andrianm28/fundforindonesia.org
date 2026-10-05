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

const CREDENTIALS_ONLY = { credentials: { id: 'credentials', name: 'credentials' } };
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

  it('renders login form with email and password fields', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /masuk$/i })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /masuk$/i })).toBeInTheDocument();
  });

  it('keeps the Google button hidden when the providers request fails', async () => {
    mockGetProviders.mockRejectedValue(new Error('network'));
    render(<LoginPage />);
    await waitFor(() => expect(mockGetProviders).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /masuk dengan google/i })).not.toBeInTheDocument();
  });

  it('links to the forgot-password page', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /lupa password\?/i })).toHaveAttribute('href', '/lupa-password');
  });

  it('renders link to register page', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /daftar di sini/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/register');
  });

  it('shows validation error when email is empty', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Email harus diisi');
    });
  });

  it('shows validation error for invalid email format', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'notanemail' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Format email tidak valid'
      );
    });
  });

  it('shows validation error when password is empty', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Password harus diisi');
    });
  });

  it('calls signIn with credentials on valid form submission', async () => {
    mockSignIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('credentials', {
        email: 'test@example.com',
        password: 'password123',
        redirect: false,
      });
    });
  });

  it('redirects to homepage on successful login', async () => {
    mockSignIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('shows error message on failed credentials', async () => {
    mockSignIn.mockResolvedValueOnce({ ok: false, error: 'CredentialsSignin' });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Email atau password salah'
      );
    });
  });

  it('shows lockout message after 5 failed attempts', async () => {
    mockSignIn.mockResolvedValue({ ok: false, error: 'CredentialsSignin' });
    render(<LoginPage />);

    // Attempt 5 failed logins
    for (let i = 0; i < 5; i++) {
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'wrong' },
      });
      fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));
      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledTimes(i + 1);
      });
    }

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Terlalu banyak percobaan. Coba lagi nanti.'
      );
    });
  });

  it('returns to the page in ?callbackUrl after a successful login', async () => {
    window.history.pushState({}, '', '/login?callbackUrl=%2Fvolunteer-trip%2Fmengajar');
    mockSignIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/volunteer-trip/mengajar');
    });
    window.history.pushState({}, '', '/');
  });

  it('ignores a ?callbackUrl that leaves the site', async () => {
    window.history.pushState({}, '', '/login?callbackUrl=https%3A%2F%2Fevil.example');
    mockSignIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
    window.history.pushState({}, '', '/');
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
    fireEvent.click(
      await screen.findByRole('button', { name: /masuk dengan google/i })
    );
    expect(mockSignIn).toHaveBeenCalledWith('google', { callbackUrl: '/' });
  });

  it('clears error when user types in email field', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /masuk$/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'a' },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
