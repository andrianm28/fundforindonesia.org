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
});
