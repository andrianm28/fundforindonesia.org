import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { CampaignDetail } from './CampaignDetail';

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; onLoad?: () => void; onError?: () => void }) => {
    // Simulate immediate load for testing
    if (props.onLoad) setTimeout(props.onLoad, 0);
    return <img src={src} alt={alt} />;
  },
}));

const mockCampaign = {
  id: '1',
  slug: 'bantu-korban-bencana',
  title: 'Bantu Korban Bencana Alam di Cianjur',
  description: 'Donasi untuk korban bencana',
  story: '<p>Cerita lengkap kampanye ini tentang korban bencana alam.</p>',
  coverImage: '/images/campaign-1.jpg',
  targetAmount: 50000000,
  collectedAmount: 25841000,
  category: 'bencana-alam',
  status: 'active',
  isUrgent: true,
  deadline: new Date(Date.now() + 61 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  donationCount: 150,
  creator: {
    id: 'user-1',
    name: 'Yayasan Peduli Bencana',
    avatar: '/images/avatar.jpg',
    isVerified: true,
    verificationType: 'organization',
  },
};

describe('CampaignDetail', () => {
  const mockOnDonate = vi.fn();
  const mockOnShare = vi.fn();

  beforeEach(() => {
    // Mock fetch for updates and disbursements
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders campaign title', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.getByText(mockCampaign.title)).toBeDefined();
  });

  it('renders cover image with priority loading', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    const img = screen.getByAltText(mockCampaign.title);
    expect(img).toBeDefined();
  });

  it('renders DARURAT badge for urgent campaigns', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.getByText('DARURAT')).toBeDefined();
  });

  it('does not render DARURAT badge for non-urgent campaigns', () => {
    const nonUrgent = { ...mockCampaign, isUrgent: false };
    render(
      <CampaignDetail campaign={nonUrgent} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.queryByText('DARURAT')).toBeNull();
  });

  it('renders creator name with verification badge', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    const creatorNames = screen.getAllByText(mockCampaign.creator.name);
    expect(creatorNames.length).toBeGreaterThan(0);
  });

  it('renders formatted collected amount', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.getByText('Rp25.841.000')).toBeDefined();
  });

  it('renders target amount text', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.getByText(/terkumpul dari Rp50\.000\.000/)).toBeDefined();
  });

  it('renders donation count', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.getByText('150')).toBeDefined();
    expect(screen.getByText('Donasi')).toBeDefined();
  });

  it('renders days remaining when deadline exists', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.getByText(/hari lagi/)).toBeDefined();
  });

  it('does not render days remaining when deadline is null', () => {
    const noDeadline = { ...mockCampaign, deadline: null };
    render(
      <CampaignDetail campaign={noDeadline} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.queryByText(/hari lagi/)).toBeNull();
  });

  it('renders progress bar', () => {
    const { container } = render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    const progressBar = container.querySelector('[role="progressbar"]');
    expect(progressBar).not.toBeNull();
  });

  it('renders three tab buttons', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.getByText('Story')).toBeDefined();
    expect(screen.getByText('Kabar Terbaru')).toBeDefined();
    expect(screen.getByText('Pencairan Dana')).toBeDefined();
  });

  it('renders Story tab content by default', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(
      screen.getByText('Cerita lengkap kampanye ini tentang korban bencana alam.')
    ).toBeDefined();
  });

  it('switches to Kabar Terbaru tab and fetches updates', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ updates: [] }),
    });

    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );

    fireEvent.click(screen.getByText('Kabar Terbaru'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/campaigns/${mockCampaign.slug}/updates`
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Belum ada kabar terbaru')).toBeDefined();
    });
  });

  it('switches to Pencairan Dana tab and fetches disbursements', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ disbursements: [] }),
    });

    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );

    fireEvent.click(screen.getByText('Pencairan Dana'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/campaigns/${mockCampaign.slug}/disbursements`
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Belum ada pencairan dana')).toBeDefined();
    });
  });

  it('renders Donasi sekarang button that calls onDonate', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    const donateBtn = screen.getByText('Donasi sekarang');
    fireEvent.click(donateBtn);
    expect(mockOnDonate).toHaveBeenCalledTimes(1);
  });

  it('renders share button that calls onShare', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    const shareBtn = screen.getByLabelText('Bagikan campaign');
    fireEvent.click(shareBtn);
    expect(mockOnShare).toHaveBeenCalledTimes(1);
  });

  it('renders creator info section at the bottom', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    expect(screen.getByText('Penggalang Dana')).toBeDefined();
    expect(screen.getByText('Identitas terverifikasi')).toBeDefined();
  });

  it('renders creator avatar when available', () => {
    render(
      <CampaignDetail campaign={mockCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    const avatar = screen.getByAltText(mockCampaign.creator.name);
    expect(avatar).toBeDefined();
  });

  it('renders default avatar placeholder when avatar is null', () => {
    const noAvatarCampaign = {
      ...mockCampaign,
      creator: { ...mockCampaign.creator, avatar: null },
    };
    render(
      <CampaignDetail campaign={noAvatarCampaign} onDonate={mockOnDonate} onShare={mockOnShare} />
    );
    // Should not find an img with the creator name (since we use SVG placeholder)
    expect(screen.queryByAltText(mockCampaign.creator.name)).toBeNull();
  });
});
