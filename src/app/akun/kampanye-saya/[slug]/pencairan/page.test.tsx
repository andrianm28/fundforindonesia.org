import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const useSession = vi.fn(() => ({ status: 'authenticated' as string }));
const replace = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => useSession(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
  useParams: () => ({ slug: 'sumur-desa' }),
}));

// The panel reads for itself, so the screen exists once its read resolves.
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    Response.json({
      isDemo: false,
      lifecycleStatus: 'ACTIVE',
      escrowHold: 0,
      campaignBalance: 0,
      payouts: [],
      bankAccounts: [],
    }),
  ),
);

import CampaignPayoutPage from './page';

describe('Campaign payout page', () => {
  beforeEach(() => {
    replace.mockReset();
    useSession.mockReturnValue({ status: 'authenticated' });
  });

  it('gives the Fundraiser the payout screen for their own Campaign', async () => {
    render(<CampaignPayoutPage />);

    expect(await screen.findByRole('region', { name: 'Pencairan dana' })).toBeDefined();
  });

  it('sends a signed-out visitor to the login page, like every other page under /akun', () => {
    useSession.mockReturnValue({ status: 'unauthenticated' });

    render(<CampaignPayoutPage />);

    // The other /akun pages all guard on the session before they fetch
    // anything (akun/page.tsx, pengaturan/page.tsx, kampanye-saya/page.tsx).
    // This one did not, so a person who followed a stale link, or typed the
    // URL, was told "Gagal memuat data pencairan." -- a failure of a thing
    // they had never been signed in to see, and a dead end that looks like
    // the platform is broken rather than a place they can sign in from.
    expect(replace).toHaveBeenCalledWith('/login');
    // Nothing of the screen is rendered for them: no heading, no region, and
    // no "failed to load" that is really an absence of permission.
    expect(screen.queryByRole('region', { name: 'Pencairan dana' })).toBeNull();
    expect(screen.queryByText(/Gagal memuat data pencairan/)).toBeNull();
    expect(screen.queryByText('Pencairan Dana')).toBeNull();
  });

  it('does not read anybody money while it is sending them away', () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockClear();
    useSession.mockReturnValue({ status: 'unauthenticated' });

    render(<CampaignPayoutPage />);

    expect(replace).toHaveBeenCalledWith('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
