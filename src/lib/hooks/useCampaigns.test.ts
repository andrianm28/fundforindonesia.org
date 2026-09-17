import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { useCampaigns } from './useCampaigns';
import type { CampaignsResponse } from './useCampaigns';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockCampaignsResponse: CampaignsResponse = {
  campaigns: [
    {
      id: '1',
      slug: 'bantu-korban-bencana',
      title: 'Bantu Korban Bencana',
      description: 'Bantuan untuk korban bencana alam',
      story: '<p>Story content</p>',
      coverImage: '/images/campaign1.jpg',
      targetAmount: 100000000,
      collectedAmount: 50000000,
      category: 'bencana-alam',
      status: 'active',
      isUrgent: true,
      isDemo: false,
      deadline: null,
      creatorId: 'user1',
      createdAt: new Date(),
      updatedAt: new Date(),
      creator: {
        id: 'user1',
        name: 'Yayasan Peduli',
        avatar: null,
        isVerified: true,
        verificationType: 'organization',
      },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 10,
  hasMore: false,
};

// Wrapper to clear SWR cache between tests
function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0 } },
      children
    );
  };
}

describe('useCampaigns', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches campaigns successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCampaignsResponse,
    });

    const { result } = renderHook(() => useCampaigns(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.campaigns).toHaveLength(1);
    expect(result.current.campaigns[0].title).toBe('Bantu Korban Bencana');
    expect(result.current.total).toBe(1);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.error).toBeUndefined();
  });

  it('builds query string from options', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCampaignsResponse,
    });

    renderHook(
      () => useCampaigns({ category: 'bencana-alam', urgent: true, page: 2, limit: 5 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('category=bencana-alam');
    expect(calledUrl).toContain('urgent=true');
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('limit=5');
  });

  it('dispatches toast event on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const toastHandler = vi.fn();
    window.addEventListener('toast', toastHandler as EventListener);

    renderHook(() => useCampaigns({ search: 'error-trigger' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(toastHandler).toHaveBeenCalled();
    });

    const event = toastHandler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.message).toBe('Gagal memuat data. Coba lagi.');
    expect(event.detail.type).toBe('error');

    window.removeEventListener('toast', toastHandler as EventListener);
  });

  it('calculates totalPages correctly', async () => {
    const responseWith25Items: CampaignsResponse = {
      ...mockCampaignsResponse,
      total: 25,
      pageSize: 10,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => responseWith25Items,
    });

    const { result } = renderHook(() => useCampaigns({ status: 'active' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.totalPages).toBe(3); // Math.ceil(25/10)
  });

  it('includes search parameter in query string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCampaignsResponse,
    });

    renderHook(() => useCampaigns({ search: 'bencana' }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('search=bencana');
  });

  it('returns defaults when no data yet', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => useCampaigns({ category: 'never-loads' }), {
      wrapper: createWrapper(),
    });

    // Since SWR is still loading, we should have loading state
    expect(result.current.isLoading).toBe(true);
  });
});
