import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SearchBar from './SearchBar';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('SearchBar', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders with correct placeholder text', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    expect(input).toBeInTheDocument();
  });

  it('renders the search icon', () => {
    render(<SearchBar />);
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('navigates to /search?q=... on form submit', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    fireEvent.change(input, { target: { value: 'bencana alam' } });
    fireEvent.submit(input.closest('form')!);
    expect(mockPush).toHaveBeenCalledWith('/search?q=bencana%20alam');
  });

  it('does not submit when query is empty', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    fireEvent.submit(input.closest('form')!);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not submit when query is only whitespace', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('calls onSearch callback instead of navigating when provided', () => {
    const onSearch = vi.fn();
    render(<SearchBar onSearch={onSearch} />);
    const input = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    fireEvent.change(input, { target: { value: 'kesehatan' } });
    fireEvent.submit(input.closest('form')!);
    expect(onSearch).toHaveBeenCalledWith('kesehatan');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('trims whitespace from query before submit', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    fireEvent.change(input, { target: { value: '  anak  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(mockPush).toHaveBeenCalledWith('/search?q=anak');
  });

  it('applies custom className', () => {
    render(<SearchBar className="max-w-md" />);
    const form = document.querySelector('form');
    expect(form?.className).toContain('max-w-md');
  });

  it('encodes special characters in the query', () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText('Cari yang ingin kamu bantu...');
    fireEvent.change(input, { target: { value: 'anak & ibu' } });
    fireEvent.submit(input.closest('form')!);
    expect(mockPush).toHaveBeenCalledWith('/search?q=anak%20%26%20ibu');
  });
});
