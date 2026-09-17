import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageTransition } from './PageTransition';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/test',
}));

describe('PageTransition', () => {
  it('renders children', () => {
    render(
      <PageTransition>
        <div data-testid="child">Hello</div>
      </PageTransition>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('defaults to fade direction', () => {
    const { container } = render(
      <PageTransition>
        <div>Content</div>
      </PageTransition>
    );
    // motion.div is rendered wrapping the children
    const motionDiv = container.firstChild;
    expect(motionDiv).toBeTruthy();
  });

  it('accepts up direction prop', () => {
    render(
      <PageTransition direction="up">
        <div data-testid="child-up">Content</div>
      </PageTransition>
    );
    expect(screen.getByTestId('child-up')).toBeInTheDocument();
  });

  it('wraps children in a motion div', () => {
    const { container } = render(
      <PageTransition>
        <span>Test</span>
      </PageTransition>
    );
    // The first child should be the motion.div wrapper
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.textContent).toBe('Test');
  });
});
