import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { PrayerModerationList, type PrayerRowData } from './PrayerModerationList';

const row = (over: Partial<PrayerRowData> = {}): PrayerRowData => ({
  id: 'p1',
  text: 'Semoga lekas pulih',
  amiinCount: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
  campaignSlug: 'banjir',
  campaignTitle: 'Bantu Banjir',
  hidden: false,
  hiddenAt: null,
  hiddenByName: null,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  refresh.mockClear();
});

describe('PrayerModerationList', () => {
  it('offers Sembunyikan on a visible Prayer and Tampilkan on a hidden one, both with Hapus', () => {
    const { rerender } = render(<PrayerModerationList prayers={[row()]} filter="visible" basePath="/moderasi/doa" />);
    expect(screen.getByRole('button', { name: 'Sembunyikan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tampilkan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hapus' })).toBeTruthy();

    rerender(
      <PrayerModerationList
        prayers={[row({ hidden: true, hiddenAt: '2026-11-02T00:00:00.000Z', hiddenByName: 'Verifier Satu' })]}
        filter="hidden"
        basePath="/moderasi/doa"
      />,
    );
    expect(screen.getByRole('button', { name: 'Tampilkan' })).toBeTruthy();
    expect(screen.getByText(/oleh Verifier Satu/)).toBeTruthy();
  });

  it('sends the action to the moderation API and refreshes', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PrayerModerationList prayers={[row()]} filter="visible" basePath="/moderasi/doa" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sembunyikan' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/moderasi/prayers/p1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'hide' }) }),
    );
  });

  it('asks before deleting and does nothing when declined', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PrayerModerationList prayers={[row()]} filter="visible" basePath="/moderasi/doa" />);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal in its own words", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Doa ini sudah dihapus' }) })));
    render(<PrayerModerationList prayers={[row()]} filter="visible" basePath="/moderasi/doa" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sembunyikan' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Doa ini sudah dihapus');
  });
});
