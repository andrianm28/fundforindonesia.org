import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { CampaignPrayersTab } from './CampaignPrayersTab';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CampaignPrayersTab', () => {
  it("loads the Campaign's public prayers and shows them with their Aamiin button", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        prayers: [
          { id: 'p1', text: 'Semoga lekas pulih', amiinCount: 3, donorName: 'Sari', createdAt: '2026-11-09T01:00:00.000Z', campaignSlug: 'banjir', campaignTitle: 'Banjir' },
          { id: 'p2', text: 'Doa dari hamba Allah', amiinCount: 0, donorName: null, createdAt: '2026-11-09T02:00:00.000Z', campaignSlug: 'banjir', campaignTitle: 'Banjir' },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CampaignPrayersTab slug="banjir" />);

    await waitFor(() => expect(screen.getByText('Semoga lekas pulih')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/prayers?campaignSlug=banjir&page=1&limit=5');
    expect(screen.getByText('Doa dari hamba Allah')).toBeTruthy();
    expect(screen.getByText('Sari')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Aamiin/ }).length).toBe(2);
  });

  it('says so when no one has written a prayer yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ prayers: [] }) })));
    render(<CampaignPrayersTab slug="banjir" />);
    await waitFor(() => expect(screen.getByText(/Belum ada doa/)).toBeTruthy());
  });

  it('shows the empty state, not an error page, when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<CampaignPrayersTab slug="banjir" />);
    await waitFor(() => expect(screen.getByText(/Belum ada doa/)).toBeTruthy());
  });
});
