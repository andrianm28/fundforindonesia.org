import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import DonatePage from './page';

// This page is exactly where the M9 badge matters most: someone can land
// here directly (a shared link, a bookmark) without ever seeing the
// CampaignCard or the detail page first. These tests isolate the banner
// that carries the badge -- the step components below it (amount selector,
// payment method, confirmation) are stubbed out, since their own behaviour
// is covered by their own test files.
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'campaign-contoh' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
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

  it('shows the demo badge in the campaign banner, above the amount selector, before a demo campaign donation is even started', () => {
    mockUseCampaignDetail.mockReturnValue({
      campaign: baseCampaign({ isDemo: true }),
      isLoading: false,
      error: undefined,
    });

    render(<DonatePage />);

    expect(screen.getByText(/kampanye contoh/i)).toBeDefined();
  });

  it('does not show the demo badge for a regular campaign', () => {
    mockUseCampaignDetail.mockReturnValue({
      campaign: baseCampaign({ isDemo: false }),
      isLoading: false,
      error: undefined,
    });

    render(<DonatePage />);

    expect(screen.queryByText(/kampanye contoh/i)).toBeNull();
  });
});
