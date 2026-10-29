import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { signOut } from 'next-auth/react';
import DesktopHeader from './DesktopHeader';
import { User } from '@/types';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'John Doe',
  avatar: 'https://example.com/avatar.jpg',
  phone: null,
  donationBalance: 100000,
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DesktopHeader', () => {
  it('renders logo with correct text and link', () => {
    render(<DesktopHeader user={null} onSearch={vi.fn()} />);
    const logo = screen.getByRole('img', { name: 'Fund for Indonesia' });
    expect(logo).toHaveAttribute('src', '/brand/logo-wordmark.webp');
    expect(logo.closest('a')).toHaveAttribute('href', '/');
  });

  it('renders search bar with correct placeholder', () => {
    render(<DesktopHeader user={null} onSearch={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    expect(searchInput).toBeInTheDocument();
  });

  it('calls onSearch when form is submitted with query', () => {
    const onSearch = vi.fn();
    render(<DesktopHeader user={null} onSearch={onSearch} />);

    const searchInput = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    fireEvent.change(searchInput, { target: { value: 'bencana alam' } });
    fireEvent.submit(searchInput.closest('form')!);

    expect(onSearch).toHaveBeenCalledWith('bencana alam');
  });

  it('does not call onSearch when query is empty', () => {
    const onSearch = vi.fn();
    render(<DesktopHeader user={null} onSearch={onSearch} />);

    const searchInput = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    fireEvent.submit(searchInput.closest('form')!);

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('renders navigation links with correct hrefs', () => {
    render(<DesktopHeader user={null} onSearch={vi.fn()} />);

    const donasiLink = screen.getByRole('link', { name: 'Donasi' });
    expect(donasiLink).toHaveAttribute('href', '/explore/all');

    const galangDanaLink = screen.getByRole('link', { name: 'Galang Dana' });
    expect(galangDanaLink).toHaveAttribute('href', '/campaign/create');

    expect(screen.queryByRole('link', { name: 'Zakat' })).toBeNull();
  });

  it('shows "Masuk" login button when user is null', () => {
    render(<DesktopHeader user={null} onSearch={vi.fn()} />);

    const loginButton = screen.getByRole('link', { name: 'Masuk' });
    expect(loginButton).toBeInTheDocument();
    expect(loginButton).toHaveAttribute('href', '/login');
  });

  it('shows user avatar and name when user is provided', () => {
    render(<DesktopHeader user={mockUser} onSearch={vi.fn()} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    const avatar = screen.getByAltText('John Doe');
    expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg');
    expect(screen.queryByRole('link', { name: 'Masuk' })).not.toBeInTheDocument();
  });

  it('shows notification bell with badge when user is logged in and has notifications', () => {
    render(<DesktopHeader user={mockUser} notificationCount={5} onSearch={vi.fn()} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByLabelText('Notifikasi')).toBeInTheDocument();
  });

  it('does not show notification badge when count is 0', () => {
    render(<DesktopHeader user={mockUser} notificationCount={0} onSearch={vi.fn()} />);

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('caps notification badge at 99+', () => {
    render(<DesktopHeader user={mockUser} notificationCount={150} onSearch={vi.fn()} />);

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('does not show notification bell when user is null', () => {
    render(<DesktopHeader user={null} onSearch={vi.fn()} />);

    expect(screen.queryByLabelText('Notifikasi')).not.toBeInTheDocument();
  });

  it('has hidden class for non-desktop viewports', () => {
    const { container } = render(<DesktopHeader user={null} onSearch={vi.fn()} />);
    const header = container.querySelector('header');
    expect(header).toHaveClass('hidden');
    expect(header).toHaveClass('lg:block');
  });

  it('shows staff links to a signed-in user, and to no visitor (ticket 86)', () => {
    const links = [{ href: '/admin', label: 'Admin' }];
    const { rerender } = render(<DesktopHeader user={mockUser} staffLinks={links} onSearch={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');

    rerender(<DesktopHeader user={null} staffLinks={links} onSearch={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });

  it('shows no staff link when none is passed', () => {
    render(<DesktopHeader user={mockUser} onSearch={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Moderasi' })).toBeNull();
  });

  describe('menu akun (ticket 95)', () => {
    const openMenu = () => {
      const trigger = screen.getByRole('button', { name: /John Doe/ });
      fireEvent.click(trigger);
      return trigger;
    };

    it('gives a signed-in user a button that opens a menu with Akun and Keluar', () => {
      render(<DesktopHeader user={mockUser} onSearch={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: /John Doe/ });
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('menuitem', { name: 'Akun' })).toBeNull();

      fireEvent.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menuitem', { name: 'Akun' })).toHaveAttribute('href', '/akun');
      expect(screen.getByRole('menuitem', { name: 'Keluar' })).toBeInTheDocument();
    });

    it('signs out to /login when Keluar is chosen', () => {
      render(<DesktopHeader user={mockUser} onSearch={vi.fn()} />);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Keluar' }));
      expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
    });

    it('closes on Escape and returns focus to the button', () => {
      render(<DesktopHeader user={mockUser} onSearch={vi.fn()} />);
      const trigger = openMenu();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveFocus();
    });

    it('closes on a click outside the menu', () => {
      render(<DesktopHeader user={mockUser} onSearch={vi.fn()} />);
      openMenu();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('toggles closed when the button is clicked again', () => {
      render(<DesktopHeader user={mockUser} onSearch={vi.fn()} />);
      const trigger = openMenu();
      fireEvent.click(trigger);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('shows no account button or menu to a guest, only Masuk', () => {
      render(<DesktopHeader user={null} onSearch={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /akun/i })).toBeNull();
      expect(screen.queryByRole('menuitem')).toBeNull();
      expect(screen.getByRole('link', { name: 'Masuk' })).toBeInTheDocument();
    });
  });
});
