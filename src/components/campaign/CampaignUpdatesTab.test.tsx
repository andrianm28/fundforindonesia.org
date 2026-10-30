import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { CampaignUpdatesTab } from './CampaignUpdatesTab';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function page(updates: unknown[], pageNo: number, totalPages: number) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ updates, total: 3, page: pageNo, limit: 2, totalPages }),
  } as Response);
}

const u = (id: string, title: string, content: string, images: string[] = []) => ({
  id,
  title,
  content,
  images,
  createdAt: '2026-10-01T00:00:00.000Z',
});

describe('CampaignUpdatesTab', () => {
  beforeEach(() => mockFetch.mockReset());
  afterEach(cleanup);

  it('shows an empty message when there are no updates', async () => {
    mockFetch.mockReturnValue(page([], 1, 0));
    render(<CampaignUpdatesTab slug="s" />);
    expect(await screen.findByText('Belum ada kabar terbaru untuk campaign ini.')).toBeDefined();
  });

  it('renders content as text, never as markup', async () => {
    mockFetch.mockReturnValue(page([u('1', 'Judul', '<script>alert(1)</script>\nbaris dua')], 1, 1));
    const { container } = render(<CampaignUpdatesTab slug="s" />);
    expect(await screen.findByText(/<script>alert\(1\)<\/script>/)).toBeDefined();
    expect(container.querySelector('script')).toBeNull();
  });

  it('shows only http(s) and /uploads images', async () => {
    mockFetch.mockReturnValue(
      page([u('1', 'J', 'c', ['/uploads/a.jpg', 'https://x.test/b.jpg', 'javascript:alert(1)'])], 1, 1),
    );
    const { container } = render(<CampaignUpdatesTab slug="s" />);
    await screen.findByText('J');
    expect(container.querySelectorAll('img').length).toBe(2);
  });

  it('loads the next page on demand and stops at the last', async () => {
    mockFetch
      .mockReturnValueOnce(page([u('1', 'Satu', 'a'), u('2', 'Dua', 'b')], 1, 2))
      .mockReturnValueOnce(page([u('3', 'Tiga', 'c')], 2, 2));
    render(<CampaignUpdatesTab slug="s" />);
    await screen.findByText('Satu');
    fireEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
    await screen.findByText('Tiga');
    expect(mockFetch.mock.calls[1][0]).toContain('page=2');
    expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
  });

  it('says so when the read fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as Response);
    render(<CampaignUpdatesTab slug="s" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
  });
});
