import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ProgressBar, calculatePercentage } from './ProgressBar';

afterEach(() => {
  cleanup();
});

describe('calculatePercentage', () => {
  it('calculates correct percentage for normal values', () => {
    expect(calculatePercentage(50, 100)).toBe(50);
    expect(calculatePercentage(25, 100)).toBe(25);
    expect(calculatePercentage(75, 200)).toBe(37.5);
  });

  it('returns 0 when current is 0', () => {
    expect(calculatePercentage(0, 100)).toBe(0);
  });

  it('returns 100 when current equals target', () => {
    expect(calculatePercentage(100, 100)).toBe(100);
  });

  it('caps at 100 when current exceeds target', () => {
    expect(calculatePercentage(150, 100)).toBe(100);
    expect(calculatePercentage(1000, 50)).toBe(100);
  });

  it('returns 0 when target is 0', () => {
    expect(calculatePercentage(50, 0)).toBe(0);
    expect(calculatePercentage(0, 0)).toBe(0);
  });

  it('returns 0 for negative current values', () => {
    expect(calculatePercentage(-10, 100)).toBe(0);
    expect(calculatePercentage(-50, 200)).toBe(0);
  });

  it('returns 0 for negative target values', () => {
    expect(calculatePercentage(50, -100)).toBe(0);
    expect(calculatePercentage(0, -50)).toBe(0);
  });
});

describe('ProgressBar component', () => {
  it('renders with correct aria attributes', () => {
    render(<ProgressBar current={50} target={100} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute('aria-valuenow', '50');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
  });

  it('shows percentage label when showLabel is true', () => {
    render(<ProgressBar current={75} target={100} showLabel />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('does not show label by default', () => {
    render(<ProgressBar current={75} target={100} />);
    expect(screen.queryByText('75%')).not.toBeInTheDocument();
  });

  it('caps displayed percentage at 100%', () => {
    render(<ProgressBar current={200} target={100} showLabel />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '100');
  });

  it('handles target=0 gracefully showing 0%', () => {
    render(<ProgressBar current={50} target={0} showLabel />);
    expect(screen.getByText('0%')).toBeInTheDocument();
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '0');
  });

  it('applies sm size class', () => {
    render(<ProgressBar current={50} target={100} size="sm" />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.className).toContain('h-1.5');
  });

  it('applies md size class by default', () => {
    render(<ProgressBar current={50} target={100} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.className).toContain('h-2.5');
  });

  it('fills a static bar to its percentage straight away, and follows a changed value', () => {
    const { rerender } = render(<ProgressBar current={40} target={100} />);
    const fill = () => screen.getByRole('progressbar').firstChild as HTMLElement;
    expect(fill().style.width).toBe('40%');
    rerender(<ProgressBar current={70} target={100} />);
    expect(fill().style.width).toBe('70%');
  });

  it('starts an animated bar empty, then fills it to its percentage after mount', () => {
    vi.useFakeTimers();
    try {
      render(<ProgressBar current={60} target={100} animated />);
      const fill = screen.getByRole('progressbar').firstChild as HTMLElement;
      expect(fill.style.width).toBe('0%');
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(fill.style.width).toBe('60%');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies animation transition when animated is true', () => {
    render(<ProgressBar current={50} target={100} animated />);
    const progressbar = screen.getByRole('progressbar');
    const fillBar = progressbar.firstChild as HTMLElement;
    expect(fillBar.style.transition).toBe('width 600ms ease-in-out');
  });

  it('does not apply animation transition when animated is false', () => {
    render(<ProgressBar current={50} target={100} animated={false} />);
    const progressbar = screen.getByRole('progressbar');
    const fillBar = progressbar.firstChild as HTMLElement;
    expect(fillBar.style.transition).toBe('none');
  });

  it('renders one continuous bar: a flat track with a single fill and no ticks or stripes', () => {
    const { container } = render(<ProgressBar current={50} target={100} size="sm" />);
    const track = screen.getByRole('progressbar');
    expect(track.className).toContain('bg-border');
    expect(track.style.backgroundImage).toBe('');
    expect(track.children).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="ledger-tick"]')).toHaveLength(0);
    const fill = track.firstChild as HTMLElement;
    expect(fill.style.background).not.toContain('repeating');
  });

  it('exposes an accessible name and value text', () => {
    render(<ProgressBar current={62} target={100} />);
    const track = screen.getByRole('progressbar', { name: 'Progres penggalangan dana' });
    expect(track).toHaveAttribute('aria-valuetext', '62% terkumpul');
  });
});
