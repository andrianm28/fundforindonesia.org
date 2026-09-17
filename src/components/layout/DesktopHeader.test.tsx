import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import DesktopHeader from './DesktopHeader';
import { User } from '@/types';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'John Doe',
  avatar: 'https://example.com/avatar.jpg',
  phone: null,
  isVerified: true,
  verificationType: 'ktp',
  donationBalance: 100000,
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(() => {
  cleanup();
});

describe('DesktopHeader', () => {
  it('renders logo with correct text and link', () => {
    render(<DesktopHeader user={null} onSearch={vi.fn()} />);
    const logo = screen.getByText('Fund for Indonesia');
    expect(logo).toBeInTheDocument();
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

    const zakatLink = screen.getByRole('link', { name: 'Zakat' });
    expect(zakatLink).toHaveAttribute('href', '/zakat');
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
});
