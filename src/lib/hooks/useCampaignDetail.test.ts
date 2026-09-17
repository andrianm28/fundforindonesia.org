import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { useCampaignDetail } from './useCampaignDetail';
import type { CampaignWithRelations } from '@/types/campaign';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockCampaign: CampaignWithRelations = {
  id: 'campaign-1',
  slug: 'bantu-korban-bencana',
  title: 'Bantu Korban Bencana',
  description: 'Bantuan untuk korban bencana alam',
  story: '<p>Full story here</p>',
  coverImage: '/images/campaign1.jpg',
  targetAmount: 100000000,
  collectedAmount: 50000000,
  category: 'bencana-alam',
  status: 'active',
  isUrgent: true,
  deadline: null,
  creatorId: 'user1',
  createdAt: new Date(),
  updatedAt: new Date(),
  creator: {
    id: 'user1',
    email: 'creator@example.com',
    name: 'Yayasan Peduli',
    avatar: null,
    phone: null,
    isVerified: true,
    verificationType: 'organization',
    donationBalance: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  donations: [
    {
      id: 'donation-1',
      amount: 50000,
      isAnonymous: false,
      paymentMethod: 'bank_transfer',
      paymentStatus: 'confirmed',
      campaignId: 'campaign-1',
      donorId: 'user2',
      createdAt: new Date(),
    },
  ],
  updates: [],
  disbursements: [],
  prayers: [],
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

describe('useCampaignDetail', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches campaign detail by slug', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCampaign,
    });

    const { result } = renderHook(() => useCampaignDetail('bantu-korban-bencana'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.campaign).not.toBeNull();
    expect(result.current.campaign?.title).toBe('Bantu Korban Bencana');
    expect(result.current.campaign?.collectedAmount).toBe(50000000);
    expect(result.current.error).toBeUndefined();
  });

  it('does not fetch when slug is null', () => {
    const { result } = renderHook(() => useCampaignDetail(null), {
      wrapper: createWrapper(),
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.campaign).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('shows loading state while fetching', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => useCampaignDetail('loading-slug'), {
      wrapper: createWrapper(),
    });

    expect(result.current.campaign).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('dispatches toast event on fetch error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const toastHandler = vi.fn();
    window.addEventListener('toast', toastHandler as EventListener);

    renderHook(() => useCampaignDetail('nonexistent-campaign'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(toastHandler).toHaveBeenCalled();
    });

    const event = toastHandler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.message).toBe('Gagal memuat data. Coba lagi.');

    window.removeEventListener('toast', toastHandler as EventListener);
  });

  it('provides optimisticDonate function', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCampaign,
    });

    const { result } = renderHook(() => useCampaignDetail('bantu-korban-bencana-fn'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.optimisticDonate).toBe('function');
  });

  it('fetches from correct URL path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCampaign,
    });

    renderHook(() => useCampaignDetail('my-campaign-slug'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/campaigns/my-campaign-slug');
  });
});
