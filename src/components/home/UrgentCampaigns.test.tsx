import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { UrgentCampaigns } from './UrgentCampaigns';

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

// Mock framer-motion to render plain div
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

const mockCampaigns = [
  {
    id: '1',
    slug: 'bantu-korban-bencana',
    title: 'Bantu Korban Bencana Alam di Cianjur',
    coverImage: '/images/campaign-1.jpg',
    collectedAmount: 25841000,
    targetAmount: 50000000,
    category: 'bencana-alam',
    deadline: '2025-08-01T00:00:00.000Z',
    isUrgent: true,
    creator: {
      name: 'Yayasan Peduli Bencana',
    },
  },
  {
    id: '2',
    slug: 'darurat-banjir-jakarta',
    title: 'Darurat Banjir Jakarta Selatan',
    coverImage: '/images/campaign-2.jpg',
    collectedAmount: 10000000,
    targetAmount: 30000000,
    category: 'bencana-alam',
    deadline: '2025-07-15T00:00:00.000Z',
    isUrgent: true,
    creator: {
      name: 'Relawan Banjir',
    },
  },
];

describe('UrgentCampaigns', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders section header with correct title', () => {
    render(<UrgentCampaigns campaigns={mockCampaigns} isLoading={false} />);
    expect(screen.getByText('Penggalangan Dana Mendesak')).toBeDefined();
  });

  it('renders DARURAT badge in the section header', () => {
    render(<UrgentCampaigns campaigns={mockCampaigns} isLoading={false} />);
    // The section header should have a DARURAT badge
    const badges = screen.getAllByText('DARURAT');
    // At least one badge in the header (campaigns also show badges on their cards)
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders campaign cards when not loading', () => {
    render(<UrgentCampaigns campaigns={mockCampaigns} isLoading={false} />);
    expect(screen.getByText('Bantu Korban Bencana Alam di Cianjur')).toBeDefined();
    expect(screen.getByText('Darurat Banjir Jakarta Selatan')).toBeDefined();
  });

  it('renders skeletons during loading state', () => {
    const { container } = render(<UrgentCampaigns campaigns={[]} isLoading={true} />);
    // CampaignCardSkeleton with count=3 renders 3 skeleton cards with role="status" 
    // Each card wrapper has role="status" and aria-label="Loading campaign"
    const skeletonCards = container.querySelectorAll('[aria-label="Loading campaign"]');
    expect(skeletonCards.length).toBe(3);
  });

  it('does not render campaign cards during loading', () => {
    render(<UrgentCampaigns campaigns={mockCampaigns} isLoading={true} />);
    expect(screen.queryByText('Bantu Korban Bencana Alam di Cianjur')).toBeNull();
  });

  it('renders with proper section aria-label', () => {
    render(<UrgentCampaigns campaigns={mockCampaigns} isLoading={false} />);
    const section = screen.getByRole('region', { name: 'Penggalangan Dana Mendesak' });
    expect(section).toBeDefined();
  });

  it('renders horizontal scroll container with overflow-x-auto', () => {
    const { container } = render(<UrgentCampaigns campaigns={mockCampaigns} isLoading={false} />);
    const scrollContainer = container.querySelector('.overflow-x-auto');
    expect(scrollContainer).not.toBeNull();
  });

  it('renders horizontal scroll container with scrollbar-hide', () => {
    const { container } = render(<UrgentCampaigns campaigns={mockCampaigns} isLoading={false} />);
    const scrollContainer = container.querySelector('.scrollbar-hide');
    expect(scrollContainer).not.toBeNull();
  });

  it('renders flex container with gap-4 for cards', () => {
    const { container } = render(<UrgentCampaigns campaigns={mockCampaigns} isLoading={false} />);
    const flexContainer = container.querySelector('.flex.gap-4');
    expect(flexContainer).not.toBeNull();
  });

  it('handles empty campaigns array', () => {
    const { container } = render(<UrgentCampaigns campaigns={[]} isLoading={false} />);
    expect(screen.getByText('Penggalangan Dana Mendesak')).toBeDefined();
    // Flex container should be empty
    const flexContainer = container.querySelector('.flex.gap-4');
    expect(flexContainer?.children.length).toBe(0);
  });

  it('handles campaigns with Date object deadlines', () => {
    const campaignsWithDateObj = [
      {
        ...mockCampaigns[0],
        deadline: new Date('2025-08-01T00:00:00.000Z'),
      },
    ];
    render(<UrgentCampaigns campaigns={campaignsWithDateObj} isLoading={false} />);
    expect(screen.getByText('Bantu Korban Bencana Alam di Cianjur')).toBeDefined();
  });

  it('handles campaigns with null deadline', () => {
    const campaignsWithNullDeadline = [
      {
        ...mockCampaigns[0],
        deadline: null,
      },
    ];
    render(<UrgentCampaigns campaigns={campaignsWithNullDeadline} isLoading={false} />);
    expect(screen.getByText('Bantu Korban Bencana Alam di Cianjur')).toBeDefined();
  });
});
