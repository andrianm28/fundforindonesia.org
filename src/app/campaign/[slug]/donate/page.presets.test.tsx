import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The amount step offers the presets an Admin set (PKS ticket 02), handed down
 * by the server layout; with nothing handed down it offers the old defaults.
 * The minimum donation shown in the amount error stays the one from
 * src/lib/donations.ts.
 */

vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return { ...actual, donationsEnabled: () => true };
});
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'campaign-contoh' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated' }) }));
vi.mock('@/components/donation/DonationAmountSelector', () => ({
  DonationAmountSelector: ({ presets, minAmount }: { presets: number[]; minAmount: number }) => (
    <div>
      <p data-testid="presets">{presets.join(',')}</p>
      <p data-testid="min">{minAmount}</p>
    </div>
  ),
}));
vi.mock('@/components/donation/PaymentMethodSelector', () => ({ PaymentMethodSelector: () => null }));
vi.mock('@/components/donation/DonationConfirmation', () => ({ DonationConfirmation: () => null }));
vi.mock('@/lib/hooks/useCampaignDetail', () => ({
  useCampaignDetail: () => ({
    campaign: { id: 'c1', slug: 'campaign-contoh', title: 'Bantu', lifecycleStatus: 'ACTIVE', kind: 'REGULAR' },
    isLoading: false,
    error: undefined,
  }),
}));
vi.mock('@/lib/campaign-page-status', () => ({
  donationRefusalCopy: () => '',
  offersDonating: () => true,
  statusBannerCopy: () => null,
}));

import DonatePage from './page';
import { DonationPresetsProvider } from '@/components/donation/DonationPresetsContext';
import { MIN_DONATION_AMOUNT } from '@/lib/donations';

afterEach(cleanup);

describe('DonatePage presets', () => {
  it('offers the presets the server layout handed down', () => {
    render(
      <DonationPresetsProvider presets={[5000, 15000, 30000]}>
        <DonatePage />
      </DonationPresetsProvider>,
    );
    expect(screen.getByTestId('presets').textContent).toBe('5000,15000,30000');
    expect(screen.getByTestId('min').textContent).toBe(String(MIN_DONATION_AMOUNT));
  });

  it('offers the old defaults when nothing was handed down', () => {
    render(<DonatePage />);
    expect(screen.getByTestId('presets').textContent).toBe('20000,50000,100000,250000,500000');
  });
});
