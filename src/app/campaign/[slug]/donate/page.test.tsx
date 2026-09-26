import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import DonatePage from './page';
import { DONATIONS_DISABLED_MESSAGE } from '@/lib/donations';

// Donations are disabled (DONATIONS_ENABLED = false, src/lib/donations.ts):
// getPaymentProvider() only ever resolves to a mock that fabricates payment
// instructions no bank issued and no donor can pay. This page must show
// DONATIONS_DISABLED_MESSAGE the instant a donor lands here -- before the
// amount selector, the payment method selector, or the confirmation step
// ever render -- so nobody fills in an amount only to discover at submit
// time that it can't go through.
//
// This file used to cover the M9 demo-campaign badge shown in the campaign
// banner above the amount selector. That banner is dead code while this
// gate is closed -- the disabled screen below preempts it entirely.
// Restoring that coverage is a precondition of ever flipping
// DONATIONS_ENABLED back to true, not something to test against unreachable
// code today.
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'campaign-contoh' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'unauthenticated' }),
}));

vi.mock('@/components/donation/DonationAmountSelector', () => ({
  DonationAmountSelector: () => <div data-testid="amount-selector" />,
}));
vi.mock('@/components/donation/PaymentMethodSelector', () => ({
  PaymentMethodSelector: () => <div data-testid="payment-selector" />,
}));
vi.mock('@/components/donation/DonationConfirmation', () => ({
  DonationConfirmation: () => <div data-testid="confirmation" />,
}));

const mockUseCampaignDetail = vi.fn();
vi.mock('@/lib/hooks/useCampaignDetail', () => ({
  useCampaignDetail: (...args: unknown[]) => mockUseCampaignDetail(...args),
}));

function baseCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-1',
    slug: 'campaign-contoh',
    title: 'Bantu Korban Bencana',
    collectedAmount: 1_000_000,
    isDemo: false,
    ...overrides,
  };
}

describe('DonatePage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the real disabled message instead of any donation step, for a loaded campaign', () => {
    mockUseCampaignDetail.mockReturnValue({
      campaign: baseCampaign(),
      isLoading: false,
      error: undefined,
    });

    render(<DonatePage />);

    expect(screen.getByText(DONATIONS_DISABLED_MESSAGE)).toBeDefined();
    expect(screen.queryByTestId('amount-selector')).toBeNull();
    expect(screen.queryByTestId('payment-selector')).toBeNull();
    expect(screen.queryByTestId('confirmation')).toBeNull();
  });

  it('shows the disabled message even while the campaign is still loading', () => {
    mockUseCampaignDetail.mockReturnValue({
      campaign: undefined,
      isLoading: true,
      error: undefined,
    });

    render(<DonatePage />);

    expect(screen.getByText(DONATIONS_DISABLED_MESSAGE)).toBeDefined();
    expect(screen.queryByText(/memuat/i)).toBeNull();
  });

  it('shows the disabled message even when the campaign failed to load', () => {
    mockUseCampaignDetail.mockReturnValue({
      campaign: undefined,
      isLoading: false,
      error: new Error('not found'),
    });

    render(<DonatePage />);

    expect(screen.getByText(DONATIONS_DISABLED_MESSAGE)).toBeDefined();
    expect(screen.queryByText(/tidak ditemukan/i)).toBeNull();
  });

  it('never renders a donation step, so there is no amount to fill in and no submit to reach', () => {
    mockUseCampaignDetail.mockReturnValue({
      campaign: baseCampaign({ isDemo: true }),
      isLoading: false,
      error: undefined,
    });

    render(<DonatePage />);

    expect(screen.queryByTestId('amount-selector')).toBeNull();
    expect(screen.queryByTestId('payment-selector')).toBeNull();
    expect(screen.queryByTestId('confirmation')).toBeNull();
    // The only interactive element on the disabled screen is the way back.
    expect(screen.getByRole('button', { name: /kembali/i })).toBeDefined();
  });
});
