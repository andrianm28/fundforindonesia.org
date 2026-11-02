import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn(), locale: 'id' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('next-intl', () => ({ useLocale: () => nav.locale }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('./BottomNavBar', () => ({
  default: ({ activeTab }: { activeTab: string }) => <i data-testid="tab">{activeTab}</i>,
}));
vi.mock('./DesktopHeader', () => ({
  default: ({ showLanguageSwitcher, onSearch }: { showLanguageSwitcher?: boolean; onSearch: (q: string) => void }) => (
    <button data-testid="header" data-switcher={String(!!showLanguageSwitcher)} onClick={() => onSearch('air bersih')} />
  ),
}));
vi.mock('./PageTransition', () => ({ PageTransition: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/hooks/useUnreadCount', () => ({ useUnreadCount: () => ({ unreadCount: 0 }) }));
vi.mock('@/components/layout/Footer', () => ({
  Footer: ({ showLanguageSwitcher }: { showLanguageSwitcher?: boolean }) => (
    <footer data-switcher={String(!!showLanguageSwitcher)}>footer</footer>
  ),
}));

import { AppShell } from './AppShell';
import { ConditionalFooter } from './ConditionalFooter';

afterEach(() => {
  cleanup();
  nav.locale = 'id';
  nav.push.mockClear();
});

const settings = { footer: { about: 'x' }, social: { instagram: '', twitter: '', facebook: '' } };

describe('AppShell under /en', () => {
  it.each(['/en/admin', '/en/admin/payouts', '/en/moderasi/campaigns'])('adds no main around %s', (path) => {
    nav.pathname = path;
    render(<AppShell>isi</AppShell>);
    expect(screen.queryByRole('main')).toBeNull();
  });

  it('still wraps an ordinary English page in a main', () => {
    nav.pathname = '/en/about';
    render(<AppShell>isi</AppShell>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it.each([
    ['/en/inbox', 'inbox'],
    ['/en/akun', 'akun'],
    ['/en/donasi-saya', 'donasi-saya'],
    ['/en/campaign/create', 'galang-dana'],
    ['/en', 'home'],
    ['/en/about', 'home'],
  ])('marks the same bottom tab for %s as for the unprefixed path', (path, tab) => {
    nav.pathname = path;
    render(<AppShell>isi</AppShell>);
    expect(screen.getByTestId('tab')).toHaveTextContent(tab);
  });

  it('searches within the visitor language', () => {
    nav.pathname = '/';
    render(<AppShell>isi</AppShell>);
    screen.getByTestId('header').click();
    expect(nav.push).toHaveBeenCalledWith('/search?q=air%20bersih');

    cleanup();
    nav.locale = 'en';
    nav.pathname = '/en';
    render(<AppShell>isi</AppShell>);
    screen.getByTestId('header').click();
    expect(nav.push).toHaveBeenLastCalledWith('/en/search?q=air%20bersih');
  });

  it('hands the switcher flag to the header', () => {
    nav.pathname = '/';
    render(<AppShell>isi</AppShell>);
    expect(screen.getByTestId('header')).toHaveAttribute('data-switcher', 'false');
    cleanup();
    render(<AppShell showLanguageSwitcher>isi</AppShell>);
    expect(screen.getByTestId('header')).toHaveAttribute('data-switcher', 'true');
  });
});

describe('ConditionalFooter under /en', () => {
  it.each(['/login', '/en/login', '/en/register', '/en/admin/x', '/en/moderasi'])('hides the footer on %s', (path) => {
    nav.pathname = path;
    const { container } = render(<ConditionalFooter {...settings} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['/about', '/en', '/en/about'])('shows the footer on %s', (path) => {
    nav.pathname = path;
    render(<ConditionalFooter {...settings} />);
    expect(screen.getByText('footer')).toBeInTheDocument();
  });

  it('hands the switcher flag to the footer', () => {
    nav.pathname = '/';
    render(<ConditionalFooter {...settings} showLanguageSwitcher />);
    expect(screen.getByText('footer')).toHaveAttribute('data-switcher', 'true');
  });
});
