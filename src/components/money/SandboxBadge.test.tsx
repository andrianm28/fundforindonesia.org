import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SANDBOX_LABEL, SandboxBadge } from './SandboxBadge';

describe('SandboxBadge', () => {
  it('marks test money with the UJI label', () => {
    render(<SandboxBadge sandbox />);
    expect(screen.getByTestId('sandbox-badge')).toHaveTextContent(SANDBOX_LABEL);
    expect(SANDBOX_LABEL).toBe('UJI');
  });

  it('renders nothing at all for real money, so a real figure carries no trace of the beta', () => {
    const { container } = render(<SandboxBadge sandbox={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
