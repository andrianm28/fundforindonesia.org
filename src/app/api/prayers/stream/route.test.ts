import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { publishPrayer } from '@/lib/prayer-events';

// Helper to consume a ReadableStream up to N chunks
async function readChunks(stream: ReadableStream<Uint8Array>, count: number): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  for (let i = 0; i < count; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }

  reader.releaseLock();
  return chunks;
}

function createMockRequest(): NextRequest {
  const controller = new AbortController();
  const request = new NextRequest('http://localhost:3000/api/prayers/stream', {
    signal: controller.signal,
  });
  return request;
}

describe('GET /api/prayers/stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns correct SSE headers', async () => {
    const request = createMockRequest();
    const response = await GET(request);

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('sends initial connected event', async () => {
    const request = createMockRequest();
    const response = await GET(request);

    const chunks = await readChunks(response.body!, 1);

    expect(chunks[0]).toBe('event: connected\ndata: {"status":"connected"}\n\n');
  });

  it('streams a single prayer after publish', async () => {
    const request = createMockRequest();
    const response = await GET(request);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Read initial connection event
    await reader.read();

    // Publish a prayer
    const prayer = { id: '1', text: 'Semoga lekas sembuh', donorName: 'Ahmad' };
    publishPrayer(prayer);

    // Advance timer to trigger the 2-second batch flush
    vi.advanceTimersByTime(2000);

    // Read the prayer event
    const { value } = await reader.read();
    const chunk = decoder.decode(value);

    expect(chunk).toBe(`event: prayer\ndata: ${JSON.stringify(prayer)}\n\n`);

    reader.releaseLock();
  });

  it('batches prayers when >=5 arrive within 2 seconds (backpressure)', async () => {
    const request = createMockRequest();
    const response = await GET(request);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Read initial connection event
    await reader.read();

    // Publish 5 prayers rapidly (triggers immediate flush)
    const prayers = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      text: `Prayer ${i + 1}`,
      donorName: `Donor ${i + 1}`,
    }));

    for (const prayer of prayers) {
      publishPrayer(prayer);
    }

    // Should flush immediately without waiting for timeout
    const { value } = await reader.read();
    const chunk = decoder.decode(value);

    expect(chunk).toBe(`event: prayer\ndata: ${JSON.stringify(prayers)}\n\n`);

    reader.releaseLock();
  });

  it('sends single prayer (not array) when only 1 prayer is buffered', async () => {
    const request = createMockRequest();
    const response = await GET(request);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Read initial connection event
    await reader.read();

    const prayer = { id: '1', text: 'Aamiin', donorName: 'Budi' };
    publishPrayer(prayer);

    vi.advanceTimersByTime(2000);

    const { value } = await reader.read();
    const chunk = decoder.decode(value);

    // Single prayer should not be wrapped in array
    expect(chunk).toBe(`event: prayer\ndata: ${JSON.stringify(prayer)}\n\n`);

    reader.releaseLock();
  });
});

describe('publishPrayer', () => {
  it('is exported and callable', () => {
    expect(typeof publishPrayer).toBe('function');
  });

  it('does not throw when no listeners are connected', () => {
    expect(() => publishPrayer({ id: '1', text: 'test' })).not.toThrow();
  });
});
