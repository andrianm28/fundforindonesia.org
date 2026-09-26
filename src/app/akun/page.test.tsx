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

function sessionAs(role: string, isVerified: boolean, verificationType: string | null) {
  return {
    status: 'authenticated',
    update: vi.fn(),
    data: {
      user: { id: 'user-1', name: 'Budi', email: 'budi@test.com', role, isVerified, verificationType, assignments: [] },
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
    mockUseSession.mockReturnValue(sessionAs('DONOR', false, null));

    render(<AkunPage />);

    expect(screen.queryByRole('button', { name: 'Verifikasi' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Hubungi Admin' })).toBeNull();
    expect(screen.queryByText('Menjadi Fundraiser')).toBeNull();
  });

  it('makes no identity claim for a user whose verification was self-declared (gap C2)', () => {
    mockUseSession.mockReturnValue(sessionAs('CAMPAIGN_CREATOR', true, 'ktp'));

    render(<AkunPage />);

    expect(screen.queryByText(/terverifikasi|diverifikasi/i)).toBeNull();
  });
});
