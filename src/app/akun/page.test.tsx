import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockUseSession = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
  signOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import AkunPage from './page';

// A signed-in user holding no assignment: the session carries no Role and no
// self-claimed verification (retire-role-hierarchy).
function signedIn(assignments: string[] = []) {
  return {
    status: 'authenticated',
    update: vi.fn(),
    data: {
      user: { id: 'user-1', name: 'Budi', email: 'budi@test.com', assignments },
      expires: '2099-01-01',
    },
  };
}

describe('AkunPage', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ balance: 0 }) }) as any;
  });

  afterEach(() => {
    cleanup();
    mockUseSession.mockReset();
  });

  it('asks no one to contact an Admin to become a Fundraiser: anyone registered may submit (FFI-04)', () => {
    mockUseSession.mockReturnValue(signedIn());

    render(<AkunPage />);

    expect(screen.queryByRole('button', { name: 'Verifikasi' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Hubungi Admin' })).toBeNull();
    expect(screen.queryByText('Menjadi Fundraiser')).toBeNull();
  });

  it('links to the Volunteer dashboard (ticket 37)', () => {
    mockUseSession.mockReturnValue(signedIn());

    render(<AkunPage />);

    expect(screen.getByRole('button', { name: /Keikutsertaan Volunteer Saya/ })).toBeTruthy();
  });

  it('makes no identity claim: nothing records a Verifier-checked identity yet (gap C2)', () => {
    mockUseSession.mockReturnValue(signedIn());

    render(<AkunPage />);

    expect(screen.queryByText(/terverifikasi|diverifikasi/i)).toBeNull();
  });

  it('shows the /admin and /moderasi doors by assignment held (ticket 86)', () => {
    mockUseSession.mockReturnValue(signedIn(['ADMIN', 'VERIFIER']));

    render(<AkunPage />);

    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Moderasi' })).toBeTruthy();
  });

  it('shows only the /moderasi door to a Verifier', () => {
    mockUseSession.mockReturnValue(signedIn(['VERIFIER']));

    render(<AkunPage />);

    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Moderasi' })).toBeTruthy();
  });

  it('shows no staff door to a person holding no assignment (ticket 86)', () => {
    mockUseSession.mockReturnValue(signedIn([]));

    render(<AkunPage />);

    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Moderasi' })).toBeNull();
  });
});
