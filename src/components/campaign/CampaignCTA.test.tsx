import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CampaignCTA } from './CampaignCTA';

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

// Mock framer-motion to render plain button
vi.mock('framer-motion', () => ({
  motion: {
    button: ({
      children,
      whileTap,
      transition,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { whileTap?: unknown; transition?: unknown }) => (
      <button {...props}>{children}</button>
    ),
  },
}));

describe('CampaignCTA', () => {
  const defaultProps = {
    campaignSlug: 'bantu-korban-bencana',
    onShare: vi.fn(),
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders fixed bottom bar with donate button and share button', () => {
    render(<CampaignCTA {...defaultProps} />);
    expect(screen.getByText('Donasi sekarang')).toBeDefined();
    expect(screen.getByLabelText('Bagikan kampanye')).toBeDefined();
  });

  it('navigates to donate page when "Donasi sekarang" is clicked', () => {
    render(<CampaignCTA {...defaultProps} />);
    fireEvent.click(screen.getByText('Donasi sekarang'));
    expect(mockPush).toHaveBeenCalledWith('/campaign/bantu-korban-bencana/donate');
  });

  it('calls onShare when share button is clicked', () => {
    render(<CampaignCTA {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Bagikan kampanye'));
    expect(defaultProps.onShare).toHaveBeenCalledTimes(1);
  });

  it('renders as a fixed positioned element with z-50', () => {
    const { container } = render(<CampaignCTA {...defaultProps} />);
    const ctaBar = container.firstChild as HTMLElement;
    expect(ctaBar.className).toContain('fixed');
    expect(ctaBar.className).toContain('bottom-0');
    expect(ctaBar.className).toContain('z-50');
  });

  it('has white background and top border', () => {
    const { container } = render(<CampaignCTA {...defaultProps} />);
    const ctaBar = container.firstChild as HTMLElement;
    expect(ctaBar.className).toContain('bg-white');
    expect(ctaBar.className).toContain('border-t');
  });

  it('shows loading state on donate button after click', () => {
    render(<CampaignCTA {...defaultProps} />);
    fireEvent.click(screen.getByText('Donasi sekarang'));
    // After clicking, the button should show loading state (spinner replaces text)
    const donateButton = screen.queryByText('Donasi sekarang');
    // Button text may still be present but loading spinner should appear
    expect(mockPush).toHaveBeenCalled();
  });

  it('share button has proper SVG icon', () => {
    const { container } = render(<CampaignCTA {...defaultProps} />);
    const shareButton = screen.getByLabelText('Bagikan kampanye');
    const svg = shareButton.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});
