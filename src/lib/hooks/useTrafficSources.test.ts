import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockSession = vi.hoisted(() => ({ value: { data: null as unknown, status: 'unauthenticated' } }));
vi.mock('next-auth/react', () => ({ useSession: () => mockSession.value }));

import { useTrafficSources } from './useTrafficSources';

const asUser = (id: string, assignments: string[] = []) => {
  mockSession.value = { data: { user: { id, assignments } }, status: 'authenticated' };
};

/**
 * "Counts per link are visible to the Fundraiser" (ticket 24). GET
 * /api/campaigns/[slug]/traffic-sources answers only that Campaign's
 * Fundraiser or an Admin (refuseUnlessFundraiserOrAdmin) -- everyone else
 * gets a 403, which this hook treats as "nothing to show", the same way
 * useSuspensionReason treats a non-owner's answer.
 */
describe('useTrafficSources', () => {
  beforeEach(() => {
    asUser('fundraiser-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call the route at all for an anonymous visitor', () => {
    mockSession.value = { data: null, status: 'unauthenticated' };
    global.fetch = vi.fn() as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug', 'fundraiser-1'));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('does not call the route for a signed-in stranger (not the Fundraiser, not an Admin)', () => {
    asUser('someone-else', ['VERIFIER']);
    global.fetch = vi.fn() as unknown as typeof fetch;

    renderHook(() => useTrafficSources('campaign-slug', 'fundraiser-1'));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls the route for an Admin', async () => {
    asUser('admin-1', ['ADMIN']);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sources: [] }) }) as unknown as typeof fetch;

    renderHook(() => useTrafficSources('campaign-slug', 'fundraiser-1'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('returns null while loading', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug', 'fundraiser-1'));

    expect(result.current).toBeNull();
  });

  it("returns the counts for the campaign's own Fundraiser", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sources: [{ source: 'whatsapp', count: 3 }, { source: null, count: 5 }] }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug', 'fundraiser-1'));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([
      { source: 'whatsapp', count: 3 },
      { source: null, count: 5 },
    ]);
  });

  it('stays null (nothing to show) when the API refuses the viewer', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug', 'fundraiser-1'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('stays null when the request itself fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const { result } = renderHook(() => useTrafficSources('campaign-slug', 'fundraiser-1'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
