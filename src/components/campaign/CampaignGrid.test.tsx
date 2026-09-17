import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { CampaignGrid } from './CampaignGrid';
import type { CampaignCardData } from '@/types/campaign';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      whileHover,
      transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { whileHover?: unknown; transition?: unknown }) => (
      <div {...props}>{children}</div>
    ),
  },
}));

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
let intersectionCallback: IntersectionObserverCallback;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      intersectionCallback = callback;
    }
    observe = mockObserve;
    unobserve = vi.fn();
    disconnect = mockDisconnect;
  });
});

const createMockCampaigns = (count: number): CampaignCardData[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `campaign-${i}`,
    slug: `campaign-${i}`,
    title: `Test Campaign ${i}`,
    coverImage: `/images/campaign-${i}.jpg`,
    collectedAmount: 1000000 * (i + 1),
    targetAmount: 5000000,
    category: 'bencana-alam',
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    isUrgent: false,
    isDemo: false,
    creator: {
      name: `Creator ${i}`,
      isVerified: true,
      verificationType: 'ktp',
    },
  }));

describe('CampaignGrid', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows skeletons when isLoading=true and no campaigns', () => {
    const { container } = render(
      <CampaignGrid campaigns={[]} variant="standard" isLoading={true} skeletonCount={6} />
    );
    // Should render skeleton loading states
    const loadingElements = container.querySelectorAll('[role="status"]');
    expect(loadingElements.length).toBeGreaterThan(0);
  });

  it('uses default skeletonCount of 6 when not provided', () => {
    const { container } = render(
      <CampaignGrid campaigns={[]} variant="standard" isLoading={true} />
    );
    // Each skeleton card has role="status" and aria-label="Loading campaign"
    const loadingElements = container.querySelectorAll('[aria-label="Loading campaign"]');
    expect(loadingElements.length).toBe(6);
  });

  it('shows empty state when no campaigns and not loading', () => {
    render(<CampaignGrid campaigns={[]} variant="standard" isLoading={false} />);
    expect(screen.getByText('Belum ada campaign')).toBeDefined();
  });

  it('shows custom empty message when provided', () => {
    render(
      <CampaignGrid
        campaigns={[]}
        variant="standard"
        isLoading={false}
        emptyMessage="Tidak ada campaign ditemukan"
      />
    );
    expect(screen.getByText('Tidak ada campaign ditemukan')).toBeDefined();
  });

  it('renders campaign cards in standard grid variant', () => {
    const campaigns = createMockCampaigns(3);
    render(<CampaignGrid campaigns={campaigns} variant="standard" />);

    campaigns.forEach((campaign) => {
      expect(screen.getByText(campaign.title)).toBeDefined();
    });
  });

  it('renders standard variant with responsive grid classes', () => {
    const campaigns = createMockCampaigns(3);
    const { container } = render(<CampaignGrid campaigns={campaigns} variant="standard" />);

    const grid = container.querySelector('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.className).toContain('grid-cols-1');
    expect(grid!.className).toContain('sm:grid-cols-2');
    expect(grid!.className).toContain('lg:grid-cols-3');
  });

  it('renders compact-scroll variant with horizontal flex', () => {
    const campaigns = createMockCampaigns(3);
    const { container } = render(<CampaignGrid campaigns={campaigns} variant="compact-scroll" />);

    const scrollContainer = container.querySelector('.flex.overflow-x-auto');
    expect(scrollContainer).not.toBeNull();
  });

  it('shows bottom sentinel when hasMore=true and not loading', () => {
    const campaigns = createMockCampaigns(3);
    const { container } = render(
      <CampaignGrid
        campaigns={campaigns}
        variant="standard"
        hasMore={true}
        onLoadMore={vi.fn()}
      />
    );

    const sentinel = container.querySelector('[aria-hidden="true"]');
    expect(sentinel).not.toBeNull();
  });

  it('shows loading skeletons at bottom when hasMore=true and isLoading=true', () => {
    const campaigns = createMockCampaigns(3);
    const { container } = render(
      <CampaignGrid
        campaigns={campaigns}
        variant="standard"
        hasMore={true}
        isLoading={true}
      />
    );

    // Should render both the campaigns and additional skeleton loaders at bottom
    const loadingElements = container.querySelectorAll('[aria-label="Loading campaign"]');
    expect(loadingElements.length).toBe(3); // 3 bottom loading skeletons
  });

  it('calls onLoadMore when sentinel is intersecting', () => {
    const onLoadMore = vi.fn();
    const campaigns = createMockCampaigns(3);

    render(
      <CampaignGrid
        campaigns={campaigns}
        variant="standard"
        hasMore={true}
        onLoadMore={onLoadMore}
      />
    );

    // Simulate intersection
    intersectionCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoadMore when sentinel is not intersecting', () => {
    const onLoadMore = vi.fn();
    const campaigns = createMockCampaigns(3);

    render(
      <CampaignGrid
        campaigns={campaigns}
        variant="standard"
        hasMore={true}
        onLoadMore={onLoadMore}
      />
    );

    // Simulate non-intersection
    intersectionCallback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('applies fade-in animation classes on cards', () => {
    const campaigns = createMockCampaigns(1);
    const { container } = render(<CampaignGrid campaigns={campaigns} variant="standard" />);

    // Cards start with opacity-0 translate-y-4 before intersection
    const animatedCard = container.querySelector('.transition-all');
    expect(animatedCard).not.toBeNull();
    expect(animatedCard!.className).toContain('duration-500');
  });
});
