import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { usePrayerStream, type PrayerStreamItem } from './usePrayerStream';

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((event: { data: string }) => void)[]> = {};
  onerror: (() => void) | null = null;
  readyState = 0; // CONNECTING

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (event: { data: string }) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener() {
    // No-op for tests
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  // Test helpers
  simulateEvent(event: string, data: string) {
    const messageEvent = { data };
    this.listeners[event]?.forEach((h) => h(messageEvent));
  }

  simulateError() {
    if (this.onerror) this.onerror();
  }
}

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0 } },
      children
    );
  };
}

function makePrayerStreamItem(overrides: Partial<PrayerStreamItem> = {}): PrayerStreamItem {
  return {
    id: `prayer-${Math.random().toString(36).slice(2)}`,
    text: 'Semoga lekas sembuh',
    amiinCount: 0,
    donationId: 'don-1',
    campaignId: 'camp-1',
    userId: null,
    createdAt: new Date(),
    user: { id: 'u1', name: 'Test Donor', avatar: null },
    campaign: { id: 'c1', slug: 'test-campaign', title: 'Test Campaign' },
    ...overrides,
  };
}

// SSE prayer data (StreamPrayer format from the server)
function makeSsePrayerData(overrides: Record<string, unknown> = {}) {
  return {
    id: `prayer-${Math.random().toString(36).slice(2)}`,
    text: 'Semoga lekas sembuh',
    amiinCount: 0,
    createdAt: new Date().toISOString(),
    donorName: 'Test Donor',
    donorAvatar: null,
    campaignSlug: 'test-campaign',
    campaignTitle: 'Test Campaign',
    ...overrides,
  };
}

describe('usePrayerStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    (global as unknown as Record<string, unknown>).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (global as unknown as Record<string, unknown>).EventSource;
  });

  it('connects to SSE endpoint on mount', () => {
    renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe('/api/prayers/stream');
  });

  it('does not connect when enabled is false', () => {
    renderHook(() => usePrayerStream({ enabled: false }), { wrapper: createWrapper() });

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('sets isStreaming to true on connected event', () => {
    const { result } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    act(() => {
      MockEventSource.instances[0].simulateEvent('connected', '{"status":"connected"}');
    });

    expect(result.current.isStreaming).toBe(true);
    expect(result.current.isPolling).toBe(false);
  });

  it('receives and includes prayers from SSE', () => {
    const { result } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    const prayer = makeSsePrayerData({ id: 'prayer-1', text: 'Aamiin' });

    act(() => {
      MockEventSource.instances[0].simulateEvent('connected', '{"status":"connected"}');
      MockEventSource.instances[0].simulateEvent('prayer', JSON.stringify(prayer));
    });

    expect(result.current.prayers).toHaveLength(1);
    expect(result.current.prayers[0].id).toBe('prayer-1');
    expect(result.current.prayers[0].text).toBe('Aamiin');
  });

  it('handles batched prayers (array data)', () => {
    const { result } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    const prayers = [
      makeSsePrayerData({ id: 'p1', createdAt: '2024-01-01T00:00:02Z' }),
      makeSsePrayerData({ id: 'p2', createdAt: '2024-01-01T00:00:01Z' }),
    ];

    act(() => {
      MockEventSource.instances[0].simulateEvent('connected', '{"status":"connected"}');
      MockEventSource.instances[0].simulateEvent('prayer', JSON.stringify(prayers));
    });

    expect(result.current.prayers).toHaveLength(2);
  });

  it('deduplicates prayers by id', () => {
    const { result } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    const prayer = makeSsePrayerData({ id: 'dup-1' });

    act(() => {
      MockEventSource.instances[0].simulateEvent('connected', '{"status":"connected"}');
      MockEventSource.instances[0].simulateEvent('prayer', JSON.stringify(prayer));
      MockEventSource.instances[0].simulateEvent('prayer', JSON.stringify(prayer));
    });

    expect(result.current.prayers).toHaveLength(1);
  });

  it('merges SSE prayers with initial prayers without duplicates', () => {
    const initialPrayers = [
      makePrayerStreamItem({ id: 'initial-1', createdAt: new Date('2024-01-01T00:00:00Z') }),
      makePrayerStreamItem({ id: 'initial-2', createdAt: new Date('2024-01-01T00:00:01Z') }),
    ];

    const { result } = renderHook(() => usePrayerStream({ initialPrayers }), {
      wrapper: createWrapper(),
    });

    // Should include initial prayers
    expect(result.current.prayers).toHaveLength(2);

    // Add a new prayer via SSE
    const newPrayer = makeSsePrayerData({ id: 'stream-1', createdAt: '2024-01-01T00:00:05Z' });
    act(() => {
      MockEventSource.instances[0].simulateEvent('connected', '{"status":"connected"}');
      MockEventSource.instances[0].simulateEvent('prayer', JSON.stringify(newPrayer));
    });

    expect(result.current.prayers).toHaveLength(3);

    // Send a prayer with same id as an initial prayer via SSE — should dedup
    const dupPrayer = makeSsePrayerData({ id: 'initial-1', createdAt: '2024-01-01T00:00:00Z' });
    act(() => {
      MockEventSource.instances[0].simulateEvent('prayer', JSON.stringify(dupPrayer));
    });

    // Should still be 3 (duplicate not added)
    expect(result.current.prayers).toHaveLength(3);
  });

  it('limits prayers to maxPrayers option', () => {
    const { result } = renderHook(() => usePrayerStream({ maxPrayers: 3 }), {
      wrapper: createWrapper(),
    });

    act(() => {
      MockEventSource.instances[0].simulateEvent('connected', '{"status":"connected"}');
    });

    // Send 5 prayers one at a time
    for (let i = 0; i < 5; i++) {
      act(() => {
        MockEventSource.instances[0].simulateEvent(
          'prayer',
          JSON.stringify(makeSsePrayerData({ id: `p-${i}`, createdAt: `2024-01-01T00:00:0${i}Z` }))
        );
      });
    }

    expect(result.current.prayers.length).toBeLessThanOrEqual(3);
  });

  it('attempts reconnect after 3 seconds on SSE error', () => {
    renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    expect(MockEventSource.instances).toHaveLength(1);

    // Simulate error
    act(() => {
      MockEventSource.instances[0].simulateError();
    });

    // Should not have a new instance yet
    expect(MockEventSource.instances).toHaveLength(1);

    // Advance timer by 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Should have created a new EventSource
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it('switches to polling after 3 failed reconnect attempts', () => {
    const { result } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    // Simulate 4 errors (initial + 3 reconnects = triggers polling on 4th)
    for (let i = 0; i < 4; i++) {
      act(() => {
        const lastInstance = MockEventSource.instances[MockEventSource.instances.length - 1];
        lastInstance.simulateError();
      });

      if (i < 3) {
        act(() => {
          vi.advanceTimersByTime(3000);
        });
      }
    }

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isPolling).toBe(true);
  });

  it('cleans up EventSource on unmount', () => {
    const { unmount } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    const instance = MockEventSource.instances[0];
    expect(instance.readyState).not.toBe(2);

    unmount();

    expect(instance.readyState).toBe(2); // CLOSED
  });

  it('sorts merged prayers by createdAt descending', () => {
    const initialPrayers = [
      makePrayerStreamItem({ id: 'old', createdAt: new Date('2024-01-01T00:00:00Z') }),
      makePrayerStreamItem({ id: 'new', createdAt: new Date('2024-01-01T00:00:10Z') }),
      makePrayerStreamItem({ id: 'mid', createdAt: new Date('2024-01-01T00:00:05Z') }),
    ];

    const { result } = renderHook(() => usePrayerStream({ initialPrayers }), {
      wrapper: createWrapper(),
    });

    const ids = result.current.prayers.map((p) => p.id);
    expect(ids).toEqual(['new', 'mid', 'old']);
  });

  it('ignores malformed SSE data gracefully', () => {
    const { result } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    act(() => {
      MockEventSource.instances[0].simulateEvent('connected', '{"status":"connected"}');
      MockEventSource.instances[0].simulateEvent('prayer', 'invalid-json{{{');
    });

    // Should not crash, prayers still empty
    expect(result.current.prayers).toHaveLength(0);
  });

  it('resets reconnect counter on successful connection', () => {
    const { result } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    // Simulate 2 errors + reconnects
    act(() => {
      MockEventSource.instances[0].simulateError();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => {
      MockEventSource.instances[1].simulateError();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Now simulate successful connection
    act(() => {
      MockEventSource.instances[2].simulateEvent('connected', '{"status":"connected"}');
    });

    expect(result.current.isStreaming).toBe(true);

    // Now simulate another error — should still try to reconnect since counter was reset
    act(() => {
      MockEventSource.instances[2].simulateError();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Should still attempt reconnection (not in polling mode)
    expect(result.current.isPolling).toBe(false);
  });

  it('normalizes SSE prayer data into PrayerStreamItem format', () => {
    const { result } = renderHook(() => usePrayerStream(), { wrapper: createWrapper() });

    const ssePrayer = makeSsePrayerData({
      id: 'normalized-1',
      donorName: 'Ahmad',
      donorAvatar: '/avatar.jpg',
      campaignSlug: 'bantu-warga',
      campaignTitle: 'Bantu Warga',
    });

    act(() => {
      MockEventSource.instances[0].simulateEvent('connected', '{"status":"connected"}');
      MockEventSource.instances[0].simulateEvent('prayer', JSON.stringify(ssePrayer));
    });

    const prayer = result.current.prayers[0];
    expect(prayer.id).toBe('normalized-1');
    expect(prayer.user?.name).toBe('Ahmad');
    expect(prayer.user?.avatar).toBe('/avatar.jpg');
    expect(prayer.campaign?.slug).toBe('bantu-warga');
    expect(prayer.campaign?.title).toBe('Bantu Warga');
    expect(prayer.createdAt).toBeInstanceOf(Date);
  });
});
