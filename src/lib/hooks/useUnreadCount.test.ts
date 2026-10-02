import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { useUnreadCount } from './useUnreadCount';

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
}));

import { useSession } from 'next-auth/react';
const mockUseSession = vi.mocked(useSession);

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0 } },
      children
    );
  };
}

describe('useUnreadCount', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUseSession.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches unread count when authenticated', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: '1', name: 'Test', assignments: [] }, expires: '' },
      status: 'authenticated',
      update: vi.fn(),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 5 }),
    });

    const { result } = renderHook(() => useUnreadCount(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(5);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/notifications/unread-count');
  });

  it('returns 0 unread count when not authenticated', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: vi.fn(),
    });

    const { result } = renderHook(() => useUnreadCount(), { wrapper: createWrapper() });

    expect(result.current.unreadCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 0 when API returns no data', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: '1', name: 'Test', assignments: [] }, expires: '' },
      status: 'authenticated',
      update: vi.fn(),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useUnreadCount(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // data?.count is undefined, so fallback to 0
    expect(result.current.unreadCount).toBe(0);
  });

  it('does not fetch while session is loading', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'loading',
      update: vi.fn(),
    });

    const { result } = renderHook(() => useUnreadCount(), { wrapper: createWrapper() });

    expect(result.current.unreadCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('provides a refreshCount function (mutate)', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: '1', name: 'Test', assignments: [] }, expires: '' },
      status: 'authenticated',
      update: vi.fn(),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 3 }),
    });

    const { result } = renderHook(() => useUnreadCount(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(3);
    });

    expect(typeof result.current.refreshCount).toBe('function');
  });
});
