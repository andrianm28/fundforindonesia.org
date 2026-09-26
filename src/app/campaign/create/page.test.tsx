import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockUseSession = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import CampaignCreatePage from './page';

function sessionAs(role: string, isVerified: boolean) {
  return {
    status: 'authenticated',
    data: {
      user: { id: 'user-1', role, isVerified, verificationType: null, assignments: [] },
      expires: '2099-01-01',
    },
  };
}

describe('CampaignCreatePage access', () => {
  afterEach(() => {
    cleanup();
    mockUseSession.mockReset();
  });

  it('lets any registered user, with no Role or assignment, fill in a Campaign (FFI-04)', () => {
    mockUseSession.mockReturnValue(sessionAs('DONOR', false));

    render(<CampaignCreatePage />);

    expect(screen.getByText('Judul Campaign')).toBeDefined();
    expect(screen.queryByText('Belum Terdaftar sebagai Fundraiser')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hubungi Admin' })).toBeNull();
    expect(screen.queryByText('Verifikasi Identitas Diperlukan')).toBeNull();
  });
});
