import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { VerificationBadge } from './VerificationBadge';

describe('VerificationBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when verificationType is null', () => {
    const { container } = render(<VerificationBadge verificationType={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a badge for KTP verification', () => {
    const { container } = render(<VerificationBadge verificationType="ktp" />);
    const svg = container.querySelector('svg[aria-label="Identitas terverifikasi (KTP)"]');
    expect(svg).not.toBeNull();
  });

  it('renders a badge for organization verification', () => {
    const { container } = render(<VerificationBadge verificationType="organization" />);
    const svg = container.querySelector('svg[aria-label="Organisasi terverifikasi"]');
    expect(svg).not.toBeNull();
  });

  it('shows KTP tooltip text on the wrapper title attribute', () => {
    const { container } = render(<VerificationBadge verificationType="ktp" />);
    const wrapper = container.querySelector('[title="Identitas terverifikasi (KTP)"]');
    expect(wrapper).not.toBeNull();
  });

  it('shows organization tooltip text on the wrapper title attribute', () => {
    const { container } = render(<VerificationBadge verificationType="organization" />);
    const wrapper = container.querySelector('[title="Organisasi terverifikasi"]');
    expect(wrapper).not.toBeNull();
  });

  it('includes a CSS tooltip element with correct text for KTP', () => {
    const { container } = render(<VerificationBadge verificationType="ktp" />);
    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain('Identitas terverifikasi (KTP)');
  });

  it('includes a CSS tooltip element with correct text for organization', () => {
    const { container } = render(<VerificationBadge verificationType="organization" />);
    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain('Organisasi terverifikasi');
  });

  it('applies custom className', () => {
    const { container } = render(
      <VerificationBadge verificationType="ktp" className="ml-1" />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('ml-1');
  });

  it('renders SVG icon at 16x16 size', () => {
    const { container } = render(<VerificationBadge verificationType="ktp" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('width')).toBe('16');
    expect(svg!.getAttribute('height')).toBe('16');
  });

  it('uses success green color (#00C853) for the badge', () => {
    const { container } = render(<VerificationBadge verificationType="ktp" />);
    const path = container.querySelector('svg path');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('fill')).toBe('#00C853');
  });
});
