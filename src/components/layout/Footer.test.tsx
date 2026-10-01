import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { Footer } from './Footer';

afterEach(() => cleanup());

describe('Footer', () => {
  it('shows the current year in the copyright line, not a fixed one', () => {
    render(<Footer />);
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Fund for Indonesia`))).toBeDefined();
  });
});
