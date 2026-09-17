import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LazyImage } from './LazyImage';

afterEach(() => {
  cleanup();
});

// Mock next/image since it requires Next.js runtime
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { onLoad, onError, priority, blurDataURL, placeholder, ...rest } = props;
    return (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img
        {...rest}
        data-priority={priority ? 'true' : undefined}
        data-blur={blurDataURL ? 'true' : undefined}
        data-placeholder={placeholder as string | undefined}
        data-testid="next-image"
        onLoad={onLoad as React.ReactEventHandler<HTMLImageElement>}
        onError={onError as React.ReactEventHandler<HTMLImageElement>}
      />
    );
  },
}));

describe('LazyImage', () => {
  const defaultProps = {
    src: '/test-image.jpg',
    alt: 'Test image',
    width: 300,
    height: 200,
  };

  it('renders skeleton placeholder before image loads', () => {
    const { container } = render(<LazyImage {...defaultProps} />);
    // The skeleton wrapper div with class "absolute inset-0 z-10" should be present
    const skeletonWrapper = container.querySelector('.absolute.inset-0.z-10');
    expect(skeletonWrapper).toBeInTheDocument();
  });

  it('renders image with opacity-0 initially', () => {
    render(<LazyImage {...defaultProps} />);
    const img = screen.getByTestId('next-image');
    expect(img.className).toContain('opacity-0');
  });

  it('fades in image and hides skeleton after load', () => {
    const { container } = render(<LazyImage {...defaultProps} />);
    const img = screen.getByTestId('next-image');

    fireEvent.load(img);

    expect(img.className).toContain('opacity-100');
    // Skeleton wrapper should be removed
    const skeletonWrapper = container.querySelector('.absolute.inset-0.z-10');
    expect(skeletonWrapper).not.toBeInTheDocument();
  });

  it('shows default error fallback with icon on image error', () => {
    render(<LazyImage {...defaultProps} />);
    const img = screen.getByTestId('next-image');

    fireEvent.error(img);

    const fallbackEl = screen.getByRole('img', { name: 'Test image' });
    expect(fallbackEl).toBeInTheDocument();
    const svg = fallbackEl.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('shows custom fallback component on image error', () => {
    const customFallback = <div data-testid="custom-fallback">Custom fallback</div>;
    render(<LazyImage {...defaultProps} fallback={customFallback} />);
    const img = screen.getByTestId('next-image');

    fireEvent.error(img);

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
  });

  it('calls onLoad callback when image loads', () => {
    const onLoad = vi.fn();
    render(<LazyImage {...defaultProps} onLoad={onLoad} />);
    const img = screen.getByTestId('next-image');

    fireEvent.load(img);

    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('sets priority attribute for above-fold images', () => {
    render(<LazyImage {...defaultProps} priority />);
    const img = screen.getByTestId('next-image');
    expect(img.dataset.priority).toBe('true');
  });

  it('does not set priority attribute by default', () => {
    render(<LazyImage {...defaultProps} />);
    const img = screen.getByTestId('next-image');
    expect(img.dataset.priority).toBeUndefined();
  });

  it('passes blurDataURL to Next.js Image', () => {
    const blurDataURL = 'data:image/png;base64,abc123';
    render(<LazyImage {...defaultProps} blurDataURL={blurDataURL} />);
    const img = screen.getByTestId('next-image');
    expect(img.dataset.blur).toBe('true');
  });

  it('applies 200ms transition duration class', () => {
    render(<LazyImage {...defaultProps} />);
    const img = screen.getByTestId('next-image');
    expect(img.className).toContain('duration-200');
  });

  it('applies custom className to container', () => {
    const { container } = render(
      <LazyImage {...defaultProps} className="rounded-lg" />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('rounded-lg');
  });
});
