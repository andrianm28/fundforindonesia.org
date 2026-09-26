import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CampaignCard } from './CampaignCard';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
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

const mockCampaign = {
  id: '1',
  slug: 'bantu-korban-bencana',
  title: 'Bantu Korban Bencana Alam di Cianjur',
  coverImage: '/images/campaign-1.jpg',
  collectedAmount: 25841000,
  targetAmount: 50000000,
  category: 'bencana-alam',
  deadline: new Date(Date.now() + 61 * 24 * 60 * 60 * 1000).toISOString(), // 61 days from now
  isUrgent: false,
  creator: {
    name: 'Yayasan Peduli Bencana',
  },
};

describe('CampaignCard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders campaign title with 2-line clamp', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const title = screen.getByText(mockCampaign.title);
    expect(title).toBeDefined();
    expect(title.className).toContain('line-clamp-2');
  });

  it('renders campaign cover image', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const img = screen.getByAltText(mockCampaign.title);
    expect(img).toBeDefined();
  });

  it('renders creator name when showCreator is true (default)', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    expect(screen.getByText(mockCampaign.creator.name)).toBeDefined();
  });

  it('does not render creator name when showCreator is false', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" showCreator={false} />);
    expect(screen.queryByText(mockCampaign.creator.name)).toBeNull();
  });

  it('shows no verified mark even for a creator stored as verified -- that flag is self-declared (gap C2)', () => {
    const { container } = render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const badge = container.querySelector('svg[aria-label="Organisasi terverifikasi"]');
    expect(badge).toBeNull();
  });

  it('shows no verified mark for an unverified creator', () => {
    const unverifiedCampaign = {
      ...mockCampaign,
      creator: { name: 'John' },
    };
    const { container } = render(<CampaignCard campaign={unverifiedCampaign} variant="standard" />);
    const badge = container.querySelector('svg[aria-label]');
    expect(badge).toBeNull();
  });

  it('renders formatted Rupiah amount', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    expect(screen.getByText('Rp25.841.000')).toBeDefined();
  });

  it('renders "Terkumpul" label', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    expect(screen.getByText('Terkumpul')).toBeDefined();
  });

  it('renders days remaining when showDaysRemaining is true and deadline exists', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" showDaysRemaining={true} />);
    // Should show days remaining (approximately 61)
    const daysText = screen.getByText(/\d+ hari lagi/);
    expect(daysText).toBeDefined();
  });

  it('does not render days remaining when showDaysRemaining is false', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" showDaysRemaining={false} />);
    expect(screen.queryByText(/hari lagi/)).toBeNull();
  });

  it('does not render days remaining when deadline is null', () => {
    const noDeadlineCampaign = { ...mockCampaign, deadline: null };
    render(<CampaignCard campaign={noDeadlineCampaign} variant="standard" />);
    expect(screen.queryByText(/hari lagi/)).toBeNull();
  });

  it('renders DARURAT badge for urgent campaigns', () => {
    const urgentCampaign = { ...mockCampaign, isUrgent: true };
    render(<CampaignCard campaign={urgentCampaign} variant="standard" />);
    expect(screen.getByText('DARURAT')).toBeDefined();
  });

  it('renders a "Kampanye contoh" badge for demo campaigns', () => {
    const demoCampaign = { ...mockCampaign, isDemo: true };
    render(<CampaignCard campaign={demoCampaign} variant="standard" />);
    expect(screen.getByText('Kampanye contoh')).toBeDefined();
  });

  it('does not render the demo badge for a regular campaign', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    expect(screen.queryByText('Kampanye contoh')).toBeNull();
  });

  it('navigates to /campaign/[slug] on click', () => {
    const { container } = render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const card = container.firstChild as HTMLElement;
    fireEvent.click(card);
    expect(mockPush).toHaveBeenCalledWith('/campaign/bantu-korban-bencana');
  });

  it('calls custom onClick when provided', () => {
    const onClick = vi.fn();
    const { container } = render(
      <CampaignCard campaign={mockCampaign} variant="standard" onClick={onClick} />
    );
    const card = container.firstChild as HTMLElement;
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('renders compact variant with fixed 280px width', () => {
    const { container } = render(<CampaignCard campaign={mockCampaign} variant="compact" />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('w-[280px]');
    expect(card.className).toContain('flex-shrink-0');
  });

  it('renders standard variant with full width', () => {
    const { container } = render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('w-full');
  });

  it('renders progress bar', () => {
    const { container } = render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const progressBar = container.querySelector('[role="progressbar"]');
    expect(progressBar).not.toBeNull();
  });

  it('renders the Ledger Line motif with three fixed milestone ticks under the progress bar', () => {
    const { container } = render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const ticks = container.querySelectorAll('[data-testid="ledger-tick"]');
    expect(ticks).toHaveLength(3);
    const positions = Array.from(ticks).map((tick) => (tick as HTMLElement).style.left);
    expect(positions).toEqual(['25%', '50%', '75%']);
  });

  it('does not apply the ledger gold token to the urgent badge, demo badge, or collected amount', () => {
    const urgentDemoCampaign = { ...mockCampaign, isUrgent: true, isDemo: true };
    render(<CampaignCard campaign={urgentDemoCampaign} variant="standard" />);
    const urgentBadge = screen.getByText('DARURAT');
    const demoBadge = screen.getByText('Kampanye contoh');
    const amount = screen.getByText('Rp25.841.000');
    [urgentBadge, demoBadge, amount].forEach((el) => {
      expect(el.className).not.toMatch(/ledger/i);
      expect((el as HTMLElement).style.backgroundImage || '').not.toContain('B8862E');
      expect((el as HTMLElement).style.backgroundColor || '').not.toContain('B8862E');
      expect((el as HTMLElement).style.color || '').not.toContain('B8862E');
    });
  });

  it('has proper article role and aria-label', () => {
    render(<CampaignCard campaign={mockCampaign} variant="standard" />);
    const article = screen.getByRole('article');
    expect(article.getAttribute('aria-label')).toBe(`Campaign: ${mockCampaign.title}`);
  });
});
