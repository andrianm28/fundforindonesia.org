import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CampaignDetailView, type CampaignDetailData } from './CampaignDetailView';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
  }),
}));

const mockCampaign: CampaignDetailData = {
  id: 'campaign-1',
  slug: 'bantu-korban-bencana',
  title: 'Bantu Korban Bencana Alam di Cianjur',
  description: 'Bantuan untuk korban bencana',
  story: '<p>Cerita lengkap</p>',
  coverImage: '/images/campaign-1.jpg',
  targetAmount: 50000000,
  collectedAmount: 25841000,
  category: 'bencana-alam',
  status: 'active',
  isUrgent: false,
  isDemo: false,
  deadline: null,
  createdAt: new Date('2026-01-01').toISOString(),
  creator: {
    id: 'user-1',
    name: 'Yayasan Peduli Bencana',
    avatar: null,
    isVerified: true,
    verificationType: 'organization',
  },
  donationCount: 12,
};

describe('CampaignDetailView', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not render a demo badge for a regular campaign', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.queryByText(/kampanye contoh/i)).toBeNull();
  });

  it('renders a plain-Indonesian demo badge, visible above the title, for a demo campaign', () => {
    const demoCampaign = { ...mockCampaign, isDemo: true };
    render(<CampaignDetailView campaign={demoCampaign} />);
    // Legible at a glance, before the donor ever reaches the "Donasi
    // sekarang" button fixed at the bottom -- not a tooltip.
    expect(screen.getByText(/kampanye contoh/i)).toBeDefined();
  });

  it('still renders the "Donasi sekarang" CTA for a demo campaign -- the badge is additional, not the refusal itself', () => {
    // The API (POST /api/donations) is the actual refusal; this page keeps
    // demo campaigns browsable, per the task's ruling that they stay visible.
    const demoCampaign = { ...mockCampaign, isDemo: true };
    render(<CampaignDetailView campaign={demoCampaign} />);
    expect(screen.getByText('Donasi sekarang')).toBeDefined();
  });

  it('wraps the hero image and quick info panel in a container that stacks by default and goes side-by-side from the lg breakpoint (1025px)', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const wrapper = container.querySelector('[data-testid="campaign-hero-section"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain('lg:flex');
    expect(wrapper.className).toContain('lg:flex-row');
  });

  it('caps the hero image to a 21:9 aspect ratio from lg, while keeping the existing mobile aspect ratio and height cap', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const imageBox = container.querySelector('[data-testid="campaign-hero-image"]') as HTMLElement;
    expect(imageBox).not.toBeNull();
    expect(imageBox.className).toContain('aspect-video');
    expect(imageBox.className).toContain('max-h-[300px]');
    expect(imageBox.className).toContain('lg:aspect-[21/9]');
    expect(imageBox.className).toContain('lg:max-h-none');
  });

  it('sizes the quick info panel to 2/5 width from the lg breakpoint', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const infoPanel = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(infoPanel).not.toBeNull();
    expect(infoPanel.className).toContain('lg:w-2/5');
  });

  it('keeps the quick info panel capped and centered at max-w-3xl below the lg breakpoint, matching the pre-restructure content width', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const infoPanel = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(infoPanel.className).toContain('max-w-3xl');
    expect(infoPanel.className).toContain('mx-auto');
    expect(infoPanel.className).toContain('lg:max-w-none');
  });

  it('still renders creator info, tab labels, and the campaign story below the hero section', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.getByText(mockCampaign.creator.name)).toBeDefined();
    expect(screen.getByText('Cerita')).toBeDefined();
    expect(screen.getByText('Kabar Terbaru')).toBeDefined();
    expect(screen.getByText('Pencairan Dana')).toBeDefined();
  });

  it('makes no identity claim for a creator stored as verified -- that flag is self-declared (gap C2)', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.queryByText(/terverifikasi/i)).toBeNull();
  });

  it('keeps a single fixed-position donate CTA visible on every viewport, with no separate desktop-only duplicate', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const ctaLinks = screen.getAllByText('Donasi sekarang');
    expect(ctaLinks).toHaveLength(1);
    const fixedBar = ctaLinks[0].closest('.fixed') as HTMLElement;
    expect(fixedBar).not.toBeNull();
    expect(fixedBar.className).not.toContain('lg:hidden');
  });

  it('renders the confirmed/collected amount in the Record register mono typeface', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const amount = screen.getByText('Rp25.841.000');
    expect(amount.className).toContain('font-mono');
  });

  it('does not apply the mono typeface to the target amount, title, or donate CTA', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const targetAmount = screen.getByText('Rp50.000.000');
    expect(targetAmount.className).not.toContain('font-mono');
    const titles = screen.getAllByText(mockCampaign.title);
    titles.forEach((title) => {
      expect(title.className).not.toContain('font-mono');
    });
    const donateCta = screen.getByText('Donasi sekarang');
    expect(donateCta.className).not.toContain('font-mono');
  });

  it('does not disable flex-shrink on the hero image or quick info panel, so the row can fit within its container at lg', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const heroImage = container.querySelector('[data-testid="campaign-hero-image"]') as HTMLElement;
    const quickInfo = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(heroImage.className).not.toContain('lg:flex-shrink-0');
    expect(quickInfo.className).not.toContain('lg:flex-shrink-0');
  });

  it('does not duplicate vertical padding between the quick info panel and the section below it', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const quickInfo = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(quickInfo.className).not.toContain('py-4');
    expect(quickInfo.className).toContain('pt-4');
  });
});
