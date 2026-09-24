import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import BottomNavBar from './BottomNavBar';

// Mock framer-motion to avoid animation-related issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, animate, transition, ...props }: any) => (
      <div className={className} style={style} data-testid="active-indicator">
        {children}
      </div>
    ),
  },
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('BottomNavBar', () => {
  it('renders all five navigation tabs', () => {
    render(<BottomNavBar activeTab="home" />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Galang Dana')).toBeInTheDocument();
    expect(screen.getByText('Donasi Saya')).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Akun')).toBeInTheDocument();
  });

  it('highlights the active tab with primary color', () => {
    render(<BottomNavBar activeTab="home" />);

    const homeLink = screen.getByText('Home').closest('a');
    expect(homeLink).toHaveClass('text-[#2F7A5F]');

    const inboxLink = screen.getByText('Inbox').closest('a');
    expect(inboxLink).toHaveClass('text-[#757575]');
  });

  it('sets aria-current on active tab', () => {
    render(<BottomNavBar activeTab="donasi-saya" />);

    const donasiSayaLink = screen.getByText('Donasi Saya').closest('a');
    expect(donasiSayaLink).toHaveAttribute('aria-current', 'page');

    const homeLink = screen.getByText('Home').closest('a');
    expect(homeLink).not.toHaveAttribute('aria-current');
  });

  it('shows unread badge on Inbox tab when unreadCount > 0', () => {
    render(<BottomNavBar activeTab="home" unreadCount={5} />);

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows 99+ when unreadCount exceeds 99', () => {
    render(<BottomNavBar activeTab="home" unreadCount={150} />);

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('does not show badge when unreadCount is 0', () => {
    render(<BottomNavBar activeTab="home" unreadCount={0} />);

    const badges = document.querySelectorAll('.bg-red-500');
    expect(badges.length).toBe(0);
  });

  it('does not show badge when unreadCount is undefined', () => {
    render(<BottomNavBar activeTab="home" />);

    const badges = document.querySelectorAll('.bg-red-500');
    expect(badges.length).toBe(0);
  });

  it('renders correct navigation links', () => {
    render(<BottomNavBar activeTab="home" />);

    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Galang Dana').closest('a')).toHaveAttribute('href', '/campaign/create');
    expect(screen.getByText('Donasi Saya').closest('a')).toHaveAttribute('href', '/donasi-saya');
    expect(screen.getByText('Inbox').closest('a')).toHaveAttribute('href', '/inbox');
    expect(screen.getByText('Akun').closest('a')).toHaveAttribute('href', '/akun');
  });

  it('has lg:hidden class to hide on desktop viewports', () => {
    render(<BottomNavBar activeTab="home" />);

    const nav = screen.getByLabelText('Bottom navigation');
    expect(nav).toHaveClass('lg:hidden');
  });

  it('has fixed positioning classes', () => {
    render(<BottomNavBar activeTab="home" />);

    const nav = screen.getByLabelText('Bottom navigation');
    expect(nav).toHaveClass('fixed', 'bottom-0', 'left-0', 'right-0');
  });

  it('renders the sliding active indicator', () => {
    render(<BottomNavBar activeTab="home" />);

    const indicator = screen.getByTestId('active-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass('bg-[#2F7A5F]');
  });
});
