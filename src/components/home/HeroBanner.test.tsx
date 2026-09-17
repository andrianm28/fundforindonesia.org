import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { HeroBanner } from './HeroBanner';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...props }: any) => (
      <div className={className} data-testid="motion-div" {...(props['aria-label'] ? { 'aria-label': props['aria-label'] } : {})} {...(props['aria-roledescription'] ? { 'aria-roledescription': props['aria-roledescription'] } : {})}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock LazyImage
vi.mock('@/components/ui/LazyImage', () => ({
  LazyImage: ({ src, alt, priority }: any) => (
    <img src={src} alt={alt} data-priority={priority} data-testid="lazy-image" />
  ),
}));

const mockSlides = [
  {
    image: '/images/slide1.jpg',
    headline: 'Bantu Korban Bencana',
    cta: { label: 'Donasi Sekarang', href: '/campaign/bencana' },
  },
  {
    image: '/images/slide2.jpg',
    headline: 'Zakat untuk Sesama',
    cta: { label: 'Bayar Zakat', href: '/zakat' },
  },
  {
    image: '/images/slide3.jpg',
    headline: 'Galang Dana Pendidikan',
    cta: { label: 'Lihat Selengkapnya', href: '/campaign/pendidikan' },
  },
];

describe('HeroBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing when slides array is empty', () => {
    const { container } = render(<HeroBanner slides={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the first slide initially', () => {
    render(<HeroBanner slides={mockSlides} />);
    expect(screen.getByText('Bantu Korban Bencana')).toBeInTheDocument();
    expect(screen.getByText('Donasi Sekarang')).toBeInTheDocument();
  });

  it('renders CTA button with correct href', () => {
    render(<HeroBanner slides={mockSlides} />);
    const ctaLink = screen.getByText('Donasi Sekarang');
    expect(ctaLink.closest('a')).toHaveAttribute('href', '/campaign/bencana');
  });

  it('renders dot indicators for all slides', () => {
    render(<HeroBanner slides={mockSlides} />);
    const dots = screen.getAllByRole('tab');
    expect(dots).toHaveLength(3);
  });

  it('marks the first dot as active initially', () => {
    render(<HeroBanner slides={mockSlides} />);
    const dots = screen.getAllByRole('tab');
    expect(dots[0]).toHaveAttribute('aria-selected', 'true');
    expect(dots[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('navigates to a specific slide when dot is clicked', () => {
    render(<HeroBanner slides={mockSlides} />);
    const dots = screen.getAllByRole('tab');
    
    fireEvent.click(dots[1]);
    expect(screen.getByText('Zakat untuk Sesama')).toBeInTheDocument();
    expect(dots[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('auto-rotates to the next slide after default interval (5000ms)', () => {
    render(<HeroBanner slides={mockSlides} />);
    
    expect(screen.getByText('Bantu Korban Bencana')).toBeInTheDocument();
    
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    
    expect(screen.getByText('Zakat untuk Sesama')).toBeInTheDocument();
  });

  it('respects custom autoPlayInterval', () => {
    render(<HeroBanner slides={mockSlides} autoPlayInterval={3000} />);
    
    expect(screen.getByText('Bantu Korban Bencana')).toBeInTheDocument();
    
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    
    expect(screen.getByText('Zakat untuk Sesama')).toBeInTheDocument();
  });

  it('pauses auto-rotation on mouse enter and resumes on mouse leave', () => {
    render(<HeroBanner slides={mockSlides} autoPlayInterval={2000} />);
    const banner = screen.getByRole('region');
    
    // Hover to pause
    fireEvent.mouseEnter(banner);
    
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    
    // Should still be on the first slide
    expect(screen.getByText('Bantu Korban Bencana')).toBeInTheDocument();
    
    // Mouse leave to resume
    fireEvent.mouseLeave(banner);
    
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    
    // Should move to next slide
    expect(screen.getByText('Zakat untuk Sesama')).toBeInTheDocument();
  });

  it('cycles back to first slide after the last slide', () => {
    render(<HeroBanner slides={mockSlides} autoPlayInterval={1000} />);
    
    act(() => {
      vi.advanceTimersByTime(3000); // 3 intervals
    });
    
    // Should be back to first slide (0 -> 1 -> 2 -> 0)
    expect(screen.getByText('Bantu Korban Bencana')).toBeInTheDocument();
  });

  it('handles swipe left (next slide)', () => {
    render(<HeroBanner slides={mockSlides} />);
    const banner = screen.getByRole('region');
    
    // Simulate swipe left (touch start at 200, end at 100)
    fireEvent.touchStart(banner, { touches: [{ clientX: 200 }] });
    fireEvent.touchMove(banner, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(banner);
    
    expect(screen.getByText('Zakat untuk Sesama')).toBeInTheDocument();
  });

  it('handles swipe right (previous slide)', () => {
    render(<HeroBanner slides={mockSlides} />);
    const banner = screen.getByRole('region');
    
    // First go to slide 2
    const dots = screen.getAllByRole('tab');
    fireEvent.click(dots[1]);
    expect(screen.getByText('Zakat untuk Sesama')).toBeInTheDocument();
    
    // Simulate swipe right (touch start at 100, end at 200)
    fireEvent.touchStart(banner, { touches: [{ clientX: 100 }] });
    fireEvent.touchMove(banner, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(banner);
    
    expect(screen.getByText('Bantu Korban Bencana')).toBeInTheDocument();
  });

  it('ignores swipes that are too short', () => {
    render(<HeroBanner slides={mockSlides} />);
    const banner = screen.getByRole('region');
    
    // Simulate short swipe (less than 50px threshold)
    fireEvent.touchStart(banner, { touches: [{ clientX: 200 }] });
    fireEvent.touchMove(banner, { touches: [{ clientX: 180 }] });
    fireEvent.touchEnd(banner);
    
    // Should still be on first slide
    expect(screen.getByText('Bantu Korban Bencana')).toBeInTheDocument();
  });

  it('does not show dots when there is only one slide', () => {
    render(<HeroBanner slides={[mockSlides[0]]} />);
    const dots = screen.queryAllByRole('tab');
    expect(dots).toHaveLength(0);
  });

  it('uses LazyImage with priority=true for the first slide', () => {
    render(<HeroBanner slides={mockSlides} />);
    const image = screen.getByTestId('lazy-image');
    expect(image).toHaveAttribute('data-priority', 'true');
  });

  it('has correct ARIA attributes for accessibility', () => {
    render(<HeroBanner slides={mockSlides} />);
    const region = screen.getByRole('region');
    expect(region).toHaveAttribute('aria-label', 'Hero banner carousel');
    expect(region).toHaveAttribute('aria-roledescription', 'carousel');
  });
});
