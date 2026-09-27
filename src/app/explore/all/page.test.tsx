import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import ExploreAllPage from './page';

/**
 * The catalogue filters by Kind (prd-compliance 09). The server is stood
 * in by a fetch that records which list was asked for.
 */
const mockFetch = vi.fn();

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ExploreAllPage />
    </SWRConfig>,
  );
}

describe('ExploreAllPage Kind filter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ campaigns: [], total: 0, page: 1, limit: 12 }),
    }));
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists every Kind until one is chosen, then asks only for that Kind', async () => {
    renderPage();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).not.toContain('kind=');
    expect(screen.getByRole('button', { name: 'Semua' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Wakaf' }));

    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('kind=WAKAF'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Wakaf' }).getAttribute('aria-pressed')).toBe('true');
  });

  // prd-compliance 02: Hibah is a fourth Kind, so its filter must appear
  // alongside donation/zakat/wakaf's, labelled the same way (KIND_LABEL).
  it('offers Hibah as a filter choice and asks only for that Kind once chosen', async () => {
    renderPage();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Hibah' }));

    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('kind=HIBAH'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Hibah' }).getAttribute('aria-pressed')).toBe('true');
  });
});
