import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Button } from './Button';

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('renders children text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('applies primary variant styles by default', () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole('button', { name: /primary/i });
    expect(btn).toHaveClass('bg-primary');
    expect(btn).toHaveClass('text-white');
  });

  it('applies secondary variant styles', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole('button', { name: /secondary/i });
    expect(btn).toHaveClass('bg-white');
    expect(btn).toHaveClass('text-primary');
    expect(btn).toHaveClass('border-primary');
  });

  it('applies ghost variant styles', () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole('button', { name: /ghost/i });
    expect(btn).toHaveClass('bg-transparent');
    expect(btn).toHaveClass('text-text');
  });

  it('applies danger variant styles', () => {
    render(<Button variant="danger">Danger</Button>);
    const btn = screen.getByRole('button', { name: /danger/i });
    expect(btn).toHaveClass('bg-danger');
    expect(btn).toHaveClass('text-white');
  });

  it('applies sm size styles', () => {
    render(<Button size="sm">Small</Button>);
    const btn = screen.getByRole('button', { name: /small/i });
    expect(btn).toHaveClass('px-3', 'py-1.5', 'text-sm');
  });

  it('applies md size styles by default', () => {
    render(<Button>Medium</Button>);
    const btn = screen.getByRole('button', { name: /medium/i });
    expect(btn).toHaveClass('px-5', 'py-2.5', 'text-base');
  });

  it('applies lg size styles', () => {
    render(<Button size="lg">Large</Button>);
    const btn = screen.getByRole('button', { name: /large/i });
    expect(btn).toHaveClass('px-6', 'py-3', 'text-lg');
  });

  it('applies full size styles', () => {
    render(<Button size="full">Full Width</Button>);
    const btn = screen.getByRole('button', { name: /full width/i });
    expect(btn).toHaveClass('w-full');
  });

  it('shows loading spinner when isLoading is true', () => {
    render(<Button isLoading>Loading</Button>);
    const btn = screen.getByRole('button', { name: /loading/i });
    const spinner = btn.querySelector('svg.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('disables button when isLoading is true', () => {
    render(<Button isLoading>Loading</Button>);
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });

  it('disables button when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button', { name: /disabled/i })).toBeDisabled();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button', { name: /click/i }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(<Button disabled onClick={handleClick}>No Click</Button>);
    fireEvent.click(screen.getByRole('button', { name: /no click/i }));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders leftIcon', () => {
    render(<Button leftIcon={<span data-testid="left-icon">←</span>}>With Left</Button>);
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
  });

  it('renders rightIcon', () => {
    render(<Button rightIcon={<span data-testid="right-icon">→</span>}>With Right</Button>);
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });

  it('hides leftIcon when loading', () => {
    render(<Button isLoading leftIcon={<span data-testid="left-icon">←</span>}>Loading Icon</Button>);
    expect(screen.queryByTestId('left-icon')).not.toBeInTheDocument();
  });

  it('sets button type attribute', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button', { name: /submit/i })).toHaveAttribute('type', 'submit');
  });

  it('applies custom className', () => {
    render(<Button className="custom-class">Custom</Button>);
    expect(screen.getByRole('button', { name: /custom/i })).toHaveClass('custom-class');
  });
});
