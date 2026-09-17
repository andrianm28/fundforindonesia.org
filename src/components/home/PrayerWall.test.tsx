import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PrayerWall } from './PrayerWall';
import type { PrayerStreamItem } from '@/lib/hooks/usePrayerStream';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }: any) => <div className={className}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock usePrayerStream hook - returns whatever initialPrayers is passed (sorted desc)
vi.mock('@/lib/hooks/usePrayerStream', () => ({
  usePrayerStream: ({ initialPrayers }: { initialPrayers: any[] }) => ({
    prayers: [...(initialPrayers || [])].sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
    isStreaming: true,
    isPolling: false,
  }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function createMockPrayer(overrides: Partial<PrayerStreamItem> = {}): PrayerStreamItem {
  return {
    id: 'prayer-1',
    text: 'Semoga cepat sembuh',
    amiinCount: 5,
    donationId: 'donation-1',
    campaignId: 'campaign-1',
    userId: 'user-1',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    user: {
      id: 'user-1',
      name: 'Ahmad',
      avatar: 'https://example.com/avatar.jpg',
    },
    campaign: {
      id: 'campaign-1',
      slug: 'bantu-anak-sekolah',
      title: 'Bantu Anak Sekolah',
    },
    ...overrides,
  };
}

function createMockPrayers(count: number): PrayerStreamItem[] {
  return Array.from({ length: count }, (_, i) =>
    createMockPrayer({
      id: `prayer-${i + 1}`,
      text: `Prayer text ${i + 1}`,
      amiinCount: i * 2,
      createdAt: new Date(Date.now() - i * 60000),
      user: {
        id: `user-${i + 1}`,
        name: `User ${i + 1}`,
        avatar: i % 2 === 0 ? `https://example.com/avatar-${i}.jpg` : null,
      },
      campaign: {
        id: `campaign-${i + 1}`,
        slug: `campaign-${i + 1}`,
        title: `Campaign ${i + 1}`,
      },
    })
  );
}

describe('PrayerWall', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders section header for homepage variant', () => {
    const { container } = render(
      <PrayerWall
        initialPrayers={[createMockPrayer()]}
        variant="homepage"
      />
    );

    expect(container.querySelector('h2')).toHaveTextContent('Doa-doa #OrangBaik');
  });

  it('does not render section header for campaign-detail variant', () => {
    const { container } = render(
      <PrayerWall
        initialPrayers={[createMockPrayer()]}
        variant="campaign-detail"
      />
    );

    expect(container.querySelector('h2')).toBeNull();
  });

  it('displays prayer with donor name, text, and amiin count', () => {
    const prayer = createMockPrayer({
      text: 'Semoga dimudahkan',
      amiinCount: 10,
      user: { id: 'u1', name: 'Budi', avatar: null },
    });

    const { container } = render(
      <PrayerWall initialPrayers={[prayer]} variant="homepage" />
    );

    expect(container).toHaveTextContent('Budi');
    expect(container).toHaveTextContent('Semoga dimudahkan');
    expect(container).toHaveTextContent('(10)');
  });

  it('displays "Anonim" for prayers without a user', () => {
    const prayer = createMockPrayer({ user: null, userId: null });

    const { container } = render(
      <PrayerWall initialPrayers={[prayer]} variant="homepage" />
    );

    expect(container).toHaveTextContent('Anonim');
  });

  it('displays campaign link when showCampaignLink is true', () => {
    const prayer = createMockPrayer({
      campaign: { id: 'c1', slug: 'help-education', title: 'Help Education' },
    });

    const { container } = render(
      <PrayerWall
        initialPrayers={[prayer]}
        variant="homepage"
        showCampaignLink={true}
      />
    );

    const link = container.querySelector('a[href="/campaign/help-education"]');
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent('untuk Help Education');
  });

  it('does not show campaign link when showCampaignLink is false', () => {
    const prayer = createMockPrayer({
      campaign: { id: 'c1', slug: 'help-education', title: 'Help Education' },
    });

    const { container } = render(
      <PrayerWall
        initialPrayers={[prayer]}
        variant="homepage"
        showCampaignLink={false}
      />
    );

    const link = container.querySelector('a[href="/campaign/help-education"]');
    expect(link).not.toBeInTheDocument();
  });

  it('limits visible prayers to maxVisible and shows "Lihat lebih banyak" button', () => {
    const prayers = createMockPrayers(15);

    const { container } = render(
      <PrayerWall
        initialPrayers={prayers}
        maxVisible={5}
        variant="homepage"
      />
    );

    // Should show only 5 prayer cards
    const prayerCards = container.querySelectorAll('[class*="flex gap-3"]');
    expect(prayerCards.length).toBe(5);

    // Should show "Lihat lebih banyak" button
    expect(container).toHaveTextContent('Lihat lebih banyak');
  });

  it('shows all prayers when "Lihat lebih banyak" is clicked', () => {
    const prayers = createMockPrayers(12);

    const { container } = render(
      <PrayerWall
        initialPrayers={prayers}
        maxVisible={5}
        variant="homepage"
      />
    );

    const button = screen.getByText('Lihat lebih banyak');
    fireEvent.click(button);

    // All prayers should now be visible
    const prayerCards = container.querySelectorAll('[class*="flex gap-3"]');
    expect(prayerCards.length).toBe(12);

    // Button should disappear
    expect(container).not.toHaveTextContent('Lihat lebih banyak');
  });

  it('does not show "Lihat lebih banyak" when prayers fit within maxVisible', () => {
    const prayers = createMockPrayers(3);

    const { container } = render(
      <PrayerWall
        initialPrayers={prayers}
        maxVisible={10}
        variant="homepage"
      />
    );

    expect(container).not.toHaveTextContent('Lihat lebih banyak');
  });

  it('optimistically increments amiin count on click', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ amiinCount: 6 }),
    });

    const prayer = createMockPrayer({ amiinCount: 5 });

    const { container } = render(
      <PrayerWall initialPrayers={[prayer]} variant="homepage" />
    );

    // Initial count
    expect(container).toHaveTextContent('(5)');

    // Click amiin button
    const amiinButton = container.querySelector('button[aria-label*="Aamiin"]')!;
    fireEvent.click(amiinButton);

    // Optimistic update: count should now be 6
    expect(container).toHaveTextContent('(6)');
  });

  it('reverts amiin count on API failure and shows toast', async () => {
    vi.useRealTimers();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error')
    );

    const prayer = createMockPrayer({ amiinCount: 5 });

    const { container } = render(
      <PrayerWall initialPrayers={[prayer]} variant="homepage" />
    );

    // Click amiin
    const amiinButton = container.querySelector('button[aria-label*="Aamiin"]')!;
    fireEvent.click(amiinButton);

    // Optimistic update immediately
    expect(container).toHaveTextContent('(6)');

    // Wait for API failure and revert
    await waitFor(() => {
      expect(container).toHaveTextContent('(5)');
    });

    // Toast should be visible
    await waitFor(() => {
      expect(document.body).toHaveTextContent('Gagal mengirim Aamiin. Coba lagi.');
    });
  });

  it('displays default avatar with initial when user has no avatar', () => {
    const prayer = createMockPrayer({
      user: { id: 'u1', name: 'Dewi', avatar: null },
    });

    const { container } = render(
      <PrayerWall initialPrayers={[prayer]} variant="homepage" />
    );

    // Should show the first letter of the name in the default avatar
    const avatarInitial = container.querySelector('.w-10.h-10.rounded-full.bg-gray-200 span');
    expect(avatarInitial).toHaveTextContent('D');
  });

  it('displays user avatar image when available', () => {
    const prayer = createMockPrayer({
      user: { id: 'u1', name: 'Ahmad', avatar: 'https://example.com/avatar.jpg' },
    });

    const { container } = render(
      <PrayerWall initialPrayers={[prayer]} variant="homepage" />
    );

    const avatar = container.querySelector('img[alt="Ahmad"]');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('uses default maxVisible of 10', () => {
    const prayers = createMockPrayers(15);

    const { container } = render(
      <PrayerWall initialPrayers={prayers} variant="homepage" />
    );

    // Should display exactly 10 prayer cards
    const prayerCards = container.querySelectorAll('[class*="flex gap-3"]');
    expect(prayerCards.length).toBe(10);

    // "Lihat lebih banyak" should be present
    expect(container).toHaveTextContent('Lihat lebih banyak');
  });
});
