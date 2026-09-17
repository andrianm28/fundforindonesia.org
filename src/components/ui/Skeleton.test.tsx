import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Skeleton } from './Skeleton';

afterEach(() => {
  cleanup();
});

describe('Skeleton', () => {
  describe('text variant', () => {
    it('renders single text line by default', () => {
      const { container } = render(<Skeleton variant="text" />);
      const skeleton = container.querySelector('[role="status"]')!;
      expect(skeleton).toBeInTheDocument();
      expect(skeleton.children).toHaveLength(1);
    });

    it('renders multiple lines when lines prop is provided', () => {
      const { container } = render(<Skeleton variant="text" lines={3} />);
      const skeleton = container.querySelector('[role="status"]')!;
      expect(skeleton.children).toHaveLength(3);
    });

    it('last line is shorter when multiple lines', () => {
      const { container } = render(<Skeleton variant="text" lines={3} />);
      const skeleton = container.querySelector('[role="status"]')!;
      const lastLine = skeleton.children[2] as HTMLElement;
      expect(lastLine.style.width).toBe('75%');
    });

    it('applies custom width and height', () => {
      const { container } = render(<Skeleton variant="text" width={200} height={20} />);
      const skeleton = container.querySelector('[role="status"]')!;
      const line = skeleton.children[0] as HTMLElement;
      expect(line.style.width).toBe('200px');
      expect(line.style.height).toBe('20px');
    });

    it('supports string width values', () => {
      const { container } = render(<Skeleton variant="text" width="50%" />);
      const skeleton = container.querySelector('[role="status"]')!;
      const line = skeleton.children[0] as HTMLElement;
      expect(line.style.width).toBe('50%');
    });
  });

  describe('circular variant', () => {
    it('renders a circle with default size', () => {
      const { container } = render(<Skeleton variant="circular" />);
      const skeleton = container.querySelector('[role="status"]') as HTMLElement;
      expect(skeleton).toHaveClass('rounded-full');
      expect(skeleton.style.width).toBe('48px');
      expect(skeleton.style.height).toBe('48px');
    });

    it('uses width for both dimensions', () => {
      const { container } = render(<Skeleton variant="circular" width={64} />);
      const skeleton = container.querySelector('[role="status"]') as HTMLElement;
      expect(skeleton.style.width).toBe('64px');
      expect(skeleton.style.height).toBe('64px');
    });
  });

  describe('rectangular variant', () => {
    it('renders a rectangle with default dimensions', () => {
      const { container } = render(<Skeleton variant="rectangular" />);
      const skeleton = container.querySelector('[role="status"]') as HTMLElement;
      expect(skeleton.style.width).toBe('100%');
      expect(skeleton.style.height).toBe('100px');
    });

    it('applies custom dimensions', () => {
      const { container } = render(<Skeleton variant="rectangular" width="300px" height="200px" />);
      const skeleton = container.querySelector('[role="status"]') as HTMLElement;
      expect(skeleton.style.width).toBe('300px');
      expect(skeleton.style.height).toBe('200px');
    });
  });

  describe('card variant', () => {
    it('renders a campaign card skeleton layout', () => {
      const { container } = render(<Skeleton variant="card" />);
      const skeleton = container.querySelector('[role="status"]')!;
      expect(skeleton).toBeInTheDocument();
      // Should have image area and content area
      expect(skeleton.children.length).toBeGreaterThanOrEqual(2);
    });

    it('applies custom width', () => {
      const { container } = render(<Skeleton variant="card" width="280px" />);
      const skeleton = container.querySelector('[role="status"]') as HTMLElement;
      expect(skeleton.style.width).toBe('280px');
    });
  });

  describe('shimmer animation', () => {
    it('applies shimmer class when animated is true (default)', () => {
      const { container } = render(<Skeleton variant="rectangular" />);
      const skeleton = container.querySelector('[role="status"]')!;
      expect(skeleton).toHaveClass('skeleton-shimmer');
    });

    it('does not apply shimmer class when animated is false', () => {
      const { container } = render(<Skeleton variant="rectangular" animated={false} />);
      const skeleton = container.querySelector('[role="status"]')!;
      expect(skeleton).not.toHaveClass('skeleton-shimmer');
    });

    it('text lines have shimmer when animated', () => {
      const { container } = render(<Skeleton variant="text" lines={2} />);
      const skeleton = container.querySelector('[role="status"]')!;
      const line = skeleton.children[0] as HTMLElement;
      expect(line).toHaveClass('skeleton-shimmer');
    });

    it('text lines do not have shimmer when animated is false', () => {
      const { container } = render(<Skeleton variant="text" lines={2} animated={false} />);
      const skeleton = container.querySelector('[role="status"]')!;
      const line = skeleton.children[0] as HTMLElement;
      expect(line).not.toHaveClass('skeleton-shimmer');
    });
  });

  describe('className prop', () => {
    it('applies custom className', () => {
      const { container } = render(<Skeleton variant="rectangular" className="my-custom-class" />);
      const skeleton = container.querySelector('[role="status"]')!;
      expect(skeleton).toHaveClass('my-custom-class');
    });
  });

  describe('accessibility', () => {
    it('has role="status" for text variant', () => {
      const { container } = render(<Skeleton variant="text" />);
      expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    });

    it('has role="status" for circular variant', () => {
      const { container } = render(<Skeleton variant="circular" />);
      expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    });

    it('has role="status" for rectangular variant', () => {
      const { container } = render(<Skeleton variant="rectangular" />);
      expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    });

    it('has role="status" for card variant', () => {
      const { container } = render(<Skeleton variant="card" />);
      expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    });

    it('has aria-label="Loading"', () => {
      const { container } = render(<Skeleton variant="rectangular" />);
      const skeleton = container.querySelector('[aria-label="Loading"]');
      expect(skeleton).toBeInTheDocument();
    });
  });
});
