import { useState, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';

/**
 * StreamPrayer - the flattened shape received from the SSE endpoint.
 */
export interface StreamPrayer {
  id: string;
  text: string;
  amiinCount: number;
  createdAt: string;
  donorName: string;
  donorAvatar: string | null;
  campaignSlug: string;
  campaignTitle: string;
}

/**
 * PrayerStreamItem - rich prayer type used by the PrayerWall component.
 * Backward-compatible with the existing PrayerWall implementation.
 */
export interface PrayerStreamItem {
  id: string;
  text: string;
  amiinCount: number;
  donationId: string;
  campaignId: string;
  userId?: string | null;
  createdAt: Date;
  user?: {
    id: string;
    name: string;
    avatar?: string | null;
  } | null;
  campaign?: {
    id: string;
    slug: string;
    title: string;
  };
}

export interface UsePrayerStreamOptions {
  initialPrayers?: PrayerStreamItem[];
  maxPrayers?: number; // max prayers to keep in state (default: 50)
  enabled?: boolean; // whether to connect to SSE (default: true)
}

export interface UsePrayerStreamResult {
  prayers: PrayerStreamItem[];
  isStreaming: boolean;
  isPolling: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 3000;
const POLLING_INTERVAL_MS = 30000;

const prayerFetcher = async (url: string): Promise<PrayerStreamItem[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch prayers');
  const data = await res.json();
  const prayers = data.prayers ?? data;
  return prayers.map((p: Record<string, unknown>) => ({
    ...p,
    createdAt: new Date(p.createdAt as string),
  }));
};

/**
 * Normalize an SSE StreamPrayer into a PrayerStreamItem shape for the UI.
 */
function normalizeSsePrayer(raw: StreamPrayer): PrayerStreamItem {
  return {
    id: raw.id,
    text: raw.text,
    amiinCount: raw.amiinCount,
    donationId: '',
    campaignId: '',
    userId: null,
    createdAt: new Date(raw.createdAt),
    user: raw.donorName
      ? { id: '', name: raw.donorName, avatar: raw.donorAvatar }
      : null,
    campaign: raw.campaignSlug
      ? { id: '', slug: raw.campaignSlug, title: raw.campaignTitle }
      : undefined,
  };
}

/**
 * SSE hook for prayer wall real-time updates.
 * Connects to /api/prayers/stream endpoint, buffers incoming prayers,
 * merges with initial SWR data. Falls back to SWR polling every 30 seconds
 * if SSE connection drops after 3 failed reconnect attempts.
 *
 * @param options.initialPrayers - Initial prayers to display (from server or props)
 * @param options.maxPrayers - Maximum number of prayers to keep in state (default: 50)
 * @param options.enabled - Whether to connect to SSE (default: true)
 * @returns { prayers, isStreaming, isPolling }
 */
export function usePrayerStream(options: UsePrayerStreamOptions = {}): UsePrayerStreamResult {
  const { initialPrayers = [], maxPrayers = 50, enabled = true } = options;

  const [streamPrayers, setStreamPrayers] = useState<PrayerStreamItem[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [usePolling, setUsePolling] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // SWR polling fallback — only active when SSE is unavailable
  const { data: polledPrayers } = useSWR<PrayerStreamItem[]>(
    usePolling ? '/api/prayers?limit=50' : null,
    prayerFetcher,
    {
      refreshInterval: usePolling ? POLLING_INTERVAL_MS : 0,
      revalidateOnFocus: false,
    }
  );

  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const es = new EventSource('/api/prayers/stream');
    eventSourceRef.current = es;

    es.addEventListener('connected', () => {
      if (!mountedRef.current) return;
      setIsStreaming(true);
      setUsePolling(false);
      reconnectAttemptsRef.current = 0;
    });

    es.addEventListener('prayer', (event: MessageEvent) => {
      if (!mountedRef.current) return;

      try {
        const parsed = JSON.parse(event.data);
        const rawPrayers: StreamPrayer[] = Array.isArray(parsed) ? parsed : [parsed];
        const normalized = rawPrayers.map(normalizeSsePrayer);

        setStreamPrayers((prev) => {
          const merged = [...normalized, ...prev];
          // Deduplicate by id
          const seen = new Set<string>();
          const deduped = merged.filter((p) => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
          });
          return deduped.slice(0, maxPrayers);
        });
      } catch {
        // Ignore malformed data
      }
    });

    es.onerror = () => {
      if (!mountedRef.current) return;

      es.close();
      eventSourceRef.current = null;
      setIsStreaming(false);

      reconnectAttemptsRef.current += 1;

      if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
        // Switch to polling mode permanently
        setUsePolling(true);
        return;
      }

      // Attempt reconnect after delay
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connectSSE();
        }
      }, RECONNECT_DELAY_MS);
    };
  }, [maxPrayers]);

  // Setup SSE connection on mount (only if enabled)
  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      connectSSE();
    }

    return () => {
      mountedRef.current = false;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectSSE, enabled]);

  // Merge all prayer sources: SSE stream + polled + initial, deduplicating by id
  const mergedPrayers = mergePrayers(
    streamPrayers,
    polledPrayers ?? [],
    initialPrayers,
    maxPrayers
  );

  return {
    prayers: mergedPrayers,
    isStreaming,
    isPolling: usePolling,
  };
}

function mergePrayers(
  streamPrayers: PrayerStreamItem[],
  polledPrayers: PrayerStreamItem[],
  initialPrayers: PrayerStreamItem[],
  maxPrayers: number
): PrayerStreamItem[] {
  // Priority: stream > polled > initial
  const all = [...streamPrayers, ...polledPrayers, ...initialPrayers];

  const seen = new Set<string>();
  const deduped = all.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Sort by createdAt descending
  deduped.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return timeB - timeA;
  });

  return deduped.slice(0, maxPrayers);
}
