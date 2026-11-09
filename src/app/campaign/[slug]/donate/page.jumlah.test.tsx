import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The zakat page hands the amount it calculated to the ordinary donate page as
 * `?jumlah=` (PKS pemenuhan 19). It is only a prefill: anything that is not a
 * whole amount within the donation limits is ignored, and the amount step
 * still validates whatever is chosen.
 */

vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return { ...actual, donationsEnabled: () => true };
});
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'zakat-yayasan' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated' }) }));
vi.mock('@/components/donation/DonationAmountSelector', () => ({
  DonationAmountSelector: ({ selectedAmount }: { selectedAmount: number | null }) => (
    <p data-testid="amount">{selectedAmount === null ? 'none' : selectedAmount}</p>
  ),
}));
vi.mock('@/components/donation/PaymentMethodSelector', () => ({ PaymentMethodSelector: () => null }));
vi.mock('@/components/donation/DonationConfirmation', () => ({ DonationConfirmation: () => null }));
vi.mock('@/lib/hooks/useCampaignDetail', () => ({
  useCampaignDetail: () => ({
    campaign: { id: 'c1', slug: 'zakat-yayasan', title: 'Zakat', lifecycleStatus: 'ACTIVE', kind: 'ZAKAT' },
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

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

function visit(query: string) {
  window.history.pushState({}, '', `/campaign/zakat-yayasan/donate${query}`);
  render(<DonatePage />);
}

describe('DonatePage ?jumlah=', () => {
  it('starts with the amount the zakat page calculated', async () => {
    visit('?jumlah=300000');
    await waitFor(() => expect(screen.getByTestId('amount').textContent).toBe('300000'));
  });

  it.each(['?jumlah=abc', '?jumlah=1.5', '?jumlah=-5', '?jumlah=500', '?jumlah=2000000000', ''])(
    'ignores %s and starts with no amount',
    (query) => {
      visit(query);
      expect(screen.getByTestId('amount').textContent).toBe('none');
    },
  );
});
