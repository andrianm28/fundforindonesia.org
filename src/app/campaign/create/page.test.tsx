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

describe('CampaignCreatePage access gate', () => {
  afterEach(() => {
    cleanup();
    mockUseSession.mockReset();
  });

  it('lets a Fundraiser assigned by an Admin create a campaign without a self-declared verification', () => {
    mockUseSession.mockReturnValue(sessionAs('CAMPAIGN_CREATOR', false));

    render(<CampaignCreatePage />);

    expect(screen.queryByText('Verifikasi Identitas Diperlukan')).toBeNull();
    expect(screen.getByText('Judul Campaign')).toBeDefined();
  });

  it('keeps a Donor out, pointing them to an Admin rather than a self-verification form', () => {
    mockUseSession.mockReturnValue(sessionAs('DONOR', true));

    render(<CampaignCreatePage />);

    expect(screen.queryByText('Judul Campaign')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hubungi Admin' })).toBeDefined();
  });
});
