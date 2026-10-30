import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CampaignDonationList } from './CampaignDonationList';

const page = (over: object) =>
  Response.json({
    donations: [
      { id: 'd1', amount: 50000, donorName: 'Anonim', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'd2', amount: 25000, donorName: 'Tamu', createdAt: '2026-10-02T00:00:00Z' },
    ],
    total: 12,
    page: 1,
    totalPages: 2,
    ...over,
  });

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('CampaignDonationList', () => {
  it('menampilkan nama, jumlah, dan paginasi', async () => {
    const fetchMock = vi.fn(async () => page({}));
    vi.stubGlobal('fetch', fetchMock);
    render(<CampaignDonationList slug="banjir" />);
    expect(await screen.findByText('Anonim')).toBeTruthy();
    expect(screen.getByText('Tamu')).toBeTruthy();
    expect(screen.getByText('Rp50.000')).toBeTruthy();
    fireEvent.click(screen.getByText('Berikutnya'));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/user/campaigns/banjir/donations?page=2'));
  });

  it('keadaan kosong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => page({ donations: [], total: 0, totalPages: 0 })));
    render(<CampaignDonationList slug="banjir" />);
    expect(await screen.findByText('Belum ada donasi.')).toBeTruthy();
  });

  it('404 menampilkan pesan tidak ditemukan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    render(<CampaignDonationList slug="x" />);
    expect((await screen.findByRole('alert')).textContent).toBe('Kampanye tidak ditemukan.');
  });
});
