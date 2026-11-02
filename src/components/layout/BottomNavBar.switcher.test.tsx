import { screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderIntl as render } from '../../../tests/intl';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/wakaf',
}));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
}));

import BottomNavBar from './BottomNavBar';

afterEach(cleanup);

describe('BottomNavBar language switcher (mobile entry point)', () => {
  it('is absent while the English gate is off, and the markup is the same as before', () => {
    const { container } = render(<BottomNavBar activeTab="home" />);
    expect(screen.queryByRole('link', { name: /bahasa|language/i })).toBeNull();
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe('NAV');
  });

  it('is shown on mobile only, pointing at the paired path, when asked for', () => {
    render(<BottomNavBar activeTab="home" showLanguageSwitcher />);
    const link = screen.getByRole('link', { name: 'Ganti bahasa ke English' });
    expect(link).toHaveAttribute('href', '/en/waqf');
    expect(link.parentElement?.className).toMatch(/lg:hidden/);
  });

  it('keeps the five tabs as they were', () => {
    render(<BottomNavBar activeTab="home" showLanguageSwitcher />);
    expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(5);
  });
});
