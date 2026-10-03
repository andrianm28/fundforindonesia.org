import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignCardSkeleton } from './CampaignCardSkeleton';

describe('CampaignCardSkeleton', () => {
  it('renders a single standard skeleton by default', () => {
    render(<CampaignCardSkeleton variant="standard" />);
    const loadingElements = screen.getAllByRole('status');
    // SingleCampaignCardSkeleton has role="status" plus its child Skeleton components
    expect(loadingElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders a single compact skeleton with 280px width', () => {
    const { container } = render(<CampaignCardSkeleton variant="compact" />);
    const card = container.querySelector('[style*="width: 280px"]');
    expect(card).not.toBeNull();
  });

  it('renders multiple skeletons when count is provided', () => {
    const { container } = render(<CampaignCardSkeleton variant="standard" count={3} />);
    // Should render 3 card skeletons within a grid container
    const grid = container.querySelector('.grid');
    expect(grid).not.toBeNull();
    const cards = grid!.querySelectorAll('[role="status"][aria-label="Loading campaign"]');
    expect(cards.length).toBe(3);
  });

  it('uses grid layout for multiple standard skeletons', () => {
    const { container } = render(<CampaignCardSkeleton variant="standard" count={4} />);
    const grid = container.querySelector('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.classList.contains('grid-cols-1')).toBe(true);
  });

  it('uses flex row layout for multiple compact skeletons', () => {
    const { container } = render(<CampaignCardSkeleton variant="compact" count={3} />);
    const flexRow = container.querySelector('.flex.gap-4.overflow-x-auto');
    expect(flexRow).not.toBeNull();
    const cards = flexRow!.querySelectorAll('[role="status"][aria-label="Loading campaign"]');
    expect(cards.length).toBe(3);
  });

  it('compact skeletons have shrink-0 for horizontal scroll', () => {
    const { container } = render(<CampaignCardSkeleton variant="compact" count={2} />);
    const cards = container.querySelectorAll('.shrink-0');
    expect(cards.length).toBe(2);
  });

  it('renders single skeleton without a wrapper when count is 1', () => {
    const { container } = render(<CampaignCardSkeleton variant="standard" count={1} />);
    // Should NOT have a grid or flex wrapper
    const grid = container.querySelector('.grid');
    const flexRow = container.querySelector('.flex.gap-4.overflow-x-auto');
    expect(grid).toBeNull();
    expect(flexRow).toBeNull();
  });
});
