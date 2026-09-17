import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { CampaignPrayers } from './CampaignPrayers';
import { PrayerStreamItem } from '@/lib/hooks/usePrayerStream';

// Mock framer-motion to render plain divs
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      layout,
      initial,
      animate,
      exit,
      transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      layout?: boolean;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockPrayer(overrides: Partial<PrayerStreamItem> = {}): PrayerStreamItem {
  return {
    id: 'prayer-1',
    text: 'Semoga lekas sembuh',
    amiinCount: 5,
    donationId: 'donation-1',
    campaignId: 'campaign-1',
    userId: 'user-1',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    user: {
      id: 'user-1',
      name: 'Ahmad',
      avatar: null,
    },
    campaign: {
      id: 'campaign-1',
      slug: 'bantu-anak',
      title: 'Bantu Anak Sakit',
    },
    ...overrides,
  };
}

function createMockPrayers(count: number): PrayerStreamItem[] {
  return Array.from({ length: count }, (_, i) =>
    createMockPrayer({
      id: `prayer-${i + 1}`,
      text: `Doa ke-${i + 1}`,
      amiinCount: i,
      createdAt: new Date(Date.now() - i * 60000),
      user: {
        id: `user-${i + 1}`,
        name: `User ${i + 1}`,
        avatar: null,
      },
    })
  );
}

describe('CampaignPrayers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders section header "Doa-doa Orang Baik" with total count', () => {
    const prayers = createMockPrayers(3);
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    expect(screen.getByText('Doa-doa Orang Baik')).toBeDefined();
    expect(screen.getByText('(3)')).toBeDefined();
  });

  it('renders empty state when no prayers', () => {
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={[]} />);

    expect(screen.getByText('Belum ada doa untuk campaign ini.')).toBeDefined();
  });

  it('renders prayer cards with donor name, text, and timestamp', () => {
    const prayers = [createMockPrayer()];
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    expect(screen.getByText('Ahmad')).toBeDefined();
    expect(screen.getByText('Semoga lekas sembuh')).toBeDefined();
  });

  it('renders "Anonim" for prayers without user', () => {
    const prayers = [createMockPrayer({ user: null })];
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    expect(screen.getByText('Anonim')).toBeDefined();
  });

  it('renders avatar initial when no avatar URL', () => {
    const prayers = [createMockPrayer()];
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    // Avatar initial "A" for "Ahmad"
    expect(screen.getByText('A')).toBeDefined();
  });

  it('renders amiin button with count', () => {
    const prayers = [createMockPrayer({ amiinCount: 5 })];
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    expect(screen.getByText('Aamiin')).toBeDefined();
    expect(screen.getByText('(5)')).toBeDefined();
  });

  it('optimistically increments amiin count on click', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const prayers = [createMockPrayer({ amiinCount: 3 })];
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    const amiinButton = screen.getByLabelText('Aamiin (3)');
    fireEvent.click(amiinButton);

    // Should optimistically show incremented count
    await waitFor(() => {
      expect(screen.getByText('(4)')).toBeDefined();
    });

    // Should have called the API
    expect(mockFetch).toHaveBeenCalledWith('/api/prayers/prayer-1/amiin', { method: 'POST' });
  });

  it('reverts amiin count on API failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const prayers = [createMockPrayer({ amiinCount: 3 })];
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    const amiinButton = screen.getByLabelText('Aamiin (3)');
    fireEvent.click(amiinButton);

    // Wait for revert
    await waitFor(() => {
      expect(screen.getByText('(3)')).toBeDefined();
    });
  });

  it('shows "Lihat lebih banyak" button when hasMore is true', () => {
    const prayers = createMockPrayers(5); // 5 prayers triggers hasMore
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    expect(screen.getByText('Lihat lebih banyak')).toBeDefined();
  });

  it('does not show "Lihat lebih banyak" button when prayers are fewer than 5', () => {
    const prayers = createMockPrayers(3);
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    expect(screen.queryByText('Lihat lebih banyak')).toBeNull();
  });

  it('loads more prayers when "Lihat lebih banyak" is clicked', async () => {
    const morePrayers = [
      {
        id: 'prayer-6',
        text: 'Doa baru',
        amiinCount: 0,
        createdAt: new Date().toISOString(),
        donorName: 'Budi',
        donorAvatar: null,
        campaignSlug: 'bantu-anak',
        campaignTitle: 'Bantu Anak',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ prayers: morePrayers, total: 6, page: 2, limit: 5, totalPages: 2 }),
    });

    const prayers = createMockPrayers(5);
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    const loadMoreBtn = screen.getByText('Lihat lebih banyak');
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(screen.getByText('Doa baru')).toBeDefined();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prayers?campaignSlug=bantu-anak&page=2&limit=5'
    );
  });

  it('does not show campaign links (we are already on the campaign page)', () => {
    const prayers = [createMockPrayer()];
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    // Should not show "untuk [campaign title]" links
    expect(screen.queryByText(/untuk/)).toBeNull();
  });

  it('has proper aria-label on the section', () => {
    const prayers = createMockPrayers(2);
    render(<CampaignPrayers campaignSlug="bantu-anak" initialPrayers={prayers} />);

    const section = screen.getByLabelText('Doa-doa Orang Baik');
    expect(section).toBeDefined();
  });
});
