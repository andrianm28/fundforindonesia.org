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

  it('does not render Ledger Line ticks when showLedgerLine is omitted (default)', () => {
    const { container } = render(<ProgressBar current={50} target={100} />);
    expect(container.querySelectorAll('[data-testid="ledger-tick"]')).toHaveLength(0);
  });

  it('keeps the default flat track background when showLedgerLine is omitted', () => {
    render(<ProgressBar current={50} target={100} />);
    const track = screen.getByRole('progressbar');
    expect(track.className).toContain('bg-bg-secondary');
    expect(track.style.backgroundImage).toBe('');
  });

  it('renders three Ledger Line milestone ticks at fixed 25/50/75% when showLedgerLine is true', () => {
    const { container } = render(
      <ProgressBar current={50} target={100} showLedgerLine />
    );
    const ticks = container.querySelectorAll('[data-testid="ledger-tick"]');
    expect(ticks).toHaveLength(3);
    const positions = Array.from(ticks).map((tick) => (tick as HTMLElement).style.left);
    expect(positions).toEqual(['25%', '50%', '75%']);
  });

  it('keeps Ledger Line tick positions fixed at 25/50/75% regardless of current/target', () => {
    const { container } = render(
      <ProgressBar current={950} target={1000} showLedgerLine />
    );
    const ticks = container.querySelectorAll('[data-testid="ledger-tick"]');
    const positions = Array.from(ticks).map((tick) => (tick as HTMLElement).style.left);
    expect(positions).toEqual(['25%', '50%', '75%']);
  });

  it('renders the dashed gold repeating-linear-gradient track background when showLedgerLine is true', () => {
    render(<ProgressBar current={50} target={100} showLedgerLine />);
    const track = screen.getByRole('progressbar');
    expect(track.style.backgroundImage).toContain('repeating-linear-gradient');
    expect(track.style.backgroundImage).toContain('var(--color-ledger)');
    expect(track.className).not.toContain('bg-bg-secondary');
  });

  it('still renders the real-progress fill bar on top of the Ledger Line motif', () => {
    render(<ProgressBar current={75} target={100} showLedgerLine />);
    const track = screen.getByRole('progressbar');
    expect(track).toHaveAttribute('aria-valuenow', '75');
  });

  it('stacks Ledger Line ticks above the fill bar with a contrasting outline-solid', () => {
    const { container } = render(
      <ProgressBar current={100} target={100} showLedgerLine />
    );
    const ticks = container.querySelectorAll('[data-testid="ledger-tick"]');
    expect(ticks).toHaveLength(3);
    ticks.forEach((tick) => {
      const el = tick as HTMLElement;
      expect(el.className).toContain('z-20');
      expect(el.style.backgroundColor).toBe('var(--color-ledger)');
      expect(el.style.boxShadow).toContain('#FDFBF8');
    });
    const track = screen.getByRole('progressbar');
    const fillBar = track.lastElementChild as HTMLElement;
    expect(fillBar.className).toContain('z-10');
  });

  it('keeps ticks present and stacked above the fill even when the campaign has fully met its target', () => {
    const { container } = render(
      <ProgressBar current={100} target={100} showLedgerLine />
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    const ticks = container.querySelectorAll('[data-testid="ledger-tick"]');
    expect(ticks).toHaveLength(3);
    ticks.forEach((tick) => {
      expect((tick as HTMLElement).className).toContain('z-20');
    });
  });
});
