import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// The panel reads for itself, so the screen exists once its read resolves.
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    Response.json({
      isDemo: false,
      escrowHold: 0,
      campaignBalance: 0,
      payouts: [],
      bankAccounts: [],
    }),
  ),
);

import CampaignPayoutPage from './page';

describe('Campaign payout page', () => {
  it('gives the Fundraiser the payout screen for their own Campaign', async () => {
    render(await CampaignPayoutPage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));

    expect(await screen.findByRole('region', { name: 'Pencairan dana' })).toBeDefined();
  });
});
