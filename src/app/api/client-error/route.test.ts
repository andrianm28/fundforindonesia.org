import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/rate-limit-guard', () => ({ guardRoute: vi.fn() }));
vi.mock('@/lib/error-monitoring/report', async (orig) => ({
  ...(await orig<typeof import('@/lib/error-monitoring/report')>()),
  reportError: vi.fn(),
}));

import { NextRequest, NextResponse } from 'next/server';
import { guardRoute } from '@/lib/rate-limit-guard';
import { reportError } from '@/lib/error-monitoring/report';
import { POST } from './route';

const guard = guardRoute as unknown as ReturnType<typeof vi.fn>;
const report = reportError as unknown as ReturnType<typeof vi.fn>;

function req(body: string) {
  return new NextRequest('http://localhost/api/client-error', {
    method: 'POST',
    body,
    headers: { 'x-forwarded-for': '203.0.113.9' },
  });
}

describe('POST /api/client-error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does nothing without a DSN: no limiter, no report', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    const res = await POST(req('{"message":"x"}'));
    expect(res.status).toBe(204);
    expect(guard).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('rate-limits by IP and forwards nothing when refused', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@h.example.test/1');
    guard.mockResolvedValue(NextResponse.json({}, { status: 429 }));
    const res = await POST(req('{"message":"x"}'));
    expect(res.status).toBe(429);
    expect(guard.mock.calls[0][0]).toMatchObject({ scope: 'client-error', subject: '203.0.113.9' });
    expect(report).not.toHaveBeenCalled();
  });

  it('forwards a client error server-side', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@h.example.test/1');
    const res = await POST(req('{"name":"TypeError","message":"bad","url":"/campaign/x"}'));
    expect(res.status).toBe(204);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toMatchObject({ source: 'client', url: '/campaign/x' });
  });

  it('rejects malformed and oversized bodies', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://k@h.example.test/1');
    expect((await POST(req('not json'))).status).toBe(400);
    expect((await POST(req('x'.repeat(9000)))).status).toBe(413);
    expect(report).not.toHaveBeenCalled();
  });
});
