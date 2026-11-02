import { screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderIntl as render } from '../../../tests/intl';
import type { User } from '@/types';

const mockPathname = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => mockPathname.value,
}));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
}));

import DesktopHeader from './DesktopHeader';
import BottomNavBar from './BottomNavBar';
import { Footer } from './Footer';

afterEach(cleanup);

const user: User = {
  id: 'u1',
  email: 'a@b.id',
  name: 'Budi',
  avatar: null,
  phone: null,
  donationBalance: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const hrefs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'));

describe('DesktopHeader in English', () => {
  it('speaks English and keeps the visitor under /en', () => {
    mockPathname.value = '/en/about';
    render(<DesktopHeader user={null} onSearch={vi.fn()} />, 'en');
    expect(screen.getByRole('link', { name: 'Donate' })).toHaveAttribute('href', '/en/explore/all');
    expect(screen.getByRole('link', { name: 'Fundraise' })).toHaveAttribute('href', '/en/campaign/create');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/en/login');
    expect(screen.getByRole('img', { name: 'Fund for Indonesia' }).closest('a')).toHaveAttribute('href', '/en');
    expect(screen.getByPlaceholderText('Search for something you want to help...')).toBeInTheDocument();
  });

  it('keeps the Indonesian hrefs exactly as they were', () => {
    mockPathname.value = '/about';
    render(<DesktopHeader user={null} onSearch={vi.fn()} />);
    expect(hrefs()).toEqual(['/', '/explore/all', '/campaign/create', '/program', '/login']);
  });

  it('keeps the back-office doors unprefixed: /admin has no English version', () => {
    mockPathname.value = '/en';
    render(<DesktopHeader user={user} staffLinks={[{ href: '/admin', label: 'Admin' }]} onSearch={vi.fn()} />, 'en');
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/en/inbox');
  });
});

describe('DesktopHeader language switcher', () => {
  it('is absent unless the page asks for it (English gate off)', () => {
    mockPathname.value = '/wakaf';
    render(<DesktopHeader user={null} onSearch={vi.fn()} />);
    expect(screen.queryByRole('link', { name: /bahasa|language/i })).toBeNull();
  });

  it('is shown when asked for, pointing at the paired path (Q7)', () => {
    mockPathname.value = '/wakaf';
    render(<DesktopHeader user={null} onSearch={vi.fn()} showLanguageSwitcher />);
    expect(screen.getByRole('link', { name: 'Ganti bahasa ke English' })).toHaveAttribute('href', '/en/waqf');
  });
});

describe('BottomNavBar in English', () => {
  it('speaks English and stays under /en', () => {
    render(<BottomNavBar activeTab="home" />, 'en');
    expect(screen.getByText('My Donations').closest('a')).toHaveAttribute('href', '/en/donasi-saya');
    expect(screen.getByText('Fundraise').closest('a')).toHaveAttribute('href', '/en/campaign/create');
    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/en');
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('keeps the Indonesian hrefs exactly as they were', () => {
    render(<BottomNavBar activeTab="home" />);
    expect(hrefs()).toEqual(['/', '/campaign/create', '/donasi-saya', '/inbox', '/akun']);
  });
});

describe('Footer in English', () => {
  it('speaks English, stays under /en and uses the English spelling of renamed pages', () => {
    mockPathname.value = '/en';
    render(<Footer />, 'en');
    expect(screen.getByRole('link', { name: 'Waqf' })).toHaveAttribute('href', '/en/waqf');
    expect(screen.getByRole('link', { name: 'About Us' })).toHaveAttribute('href', '/en/about');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/en/privacy');
    expect(screen.getByText(/© \d{4} Fund for Indonesia, operated by PT Jaya Korpora Prima/)).toBeDefined();
  });

  it('keeps the Indonesian hrefs exactly as they were', () => {
    mockPathname.value = '/';
    render(<Footer />);
    expect(hrefs().filter((h) => h?.startsWith('/'))).toEqual([
      '/about', '/impact', '/program', '/wakaf', '/hibah', '/volunteer-trip', '/careers', '/press',
      '/help', '/faq', '/contact', '/terms', '/privacy',
    ]);
  });
});

describe('Footer language switcher', () => {
  it('is absent unless the page asks for it (English gate off)', () => {
    mockPathname.value = '/';
    render(<Footer />);
    expect(screen.queryByRole('link', { name: /bahasa|language/i })).toBeNull();
  });

  it('is shown when asked for', () => {
    mockPathname.value = '/about';
    render(<Footer showLanguageSwitcher />);
    expect(screen.getByRole('link', { name: 'Ganti bahasa ke English' })).toHaveAttribute('href', '/en/about');
  });
});
