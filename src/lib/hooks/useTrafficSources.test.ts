import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTrafficSources } from './useTrafficSources';

/**
 * "Counts per link are visible to the Fundraiser" (ticket 24). GET
 * /api/campaigns/[slug]/traffic-sources answers only that Campaign's
 * Fundraiser or an Admin (refuseUnlessFundraiserOrAdmin) -- everyone else
 * gets a 403, which this hook treats as "nothing to show", the same way
 * useSuspensionReason treats a non-owner's answer.
 */
describe('useTrafficSources', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null while loading', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug'));

    expect(result.current).toBeNull();
  });

  it("returns the counts for the campaign's own Fundraiser", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sources: [{ source: 'whatsapp', count: 3 }, { source: null, count: 5 }] }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug'));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([
      { source: 'whatsapp', count: 3 },
      { source: null, count: 5 },
    ]);
  });

  it('stays null (nothing to show) when the API refuses the viewer', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('stays null when the request itself fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
