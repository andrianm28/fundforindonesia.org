import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { TopDonorsTab } from './TopDonorsTab';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TopDonorsTab', () => {
  it('lists the ranked donors from the API, with Anonim as given', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        donors: [
          { rank: 1, donorName: 'Anonim', amount: 900000 },
          { rank: 2, donorName: 'Dewi', amount: 100000 },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<TopDonorsTab slug="banjir" />);

    await waitFor(() => expect(screen.getByText('Dewi')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/banjir/top-donors');
    expect(screen.getByText('Anonim')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('says so when there are no donations yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ donors: [] }) })));
    render(<TopDonorsTab slug="banjir" />);
    await waitFor(() => expect(screen.getByText('Belum ada donasi.')).toBeTruthy());
  });
});
