import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/recurring-donations/service', () => ({ stopRecurringDonationByToken: vi.fn() }));

import { POST } from './route';
import { stopRecurringDonationByToken } from '@/lib/recurring-donations/service';

const mockStop = stopRecurringDonationByToken as unknown as Mock;

describe('POST /api/donasi-rutin/berhenti/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://fundforindonesia.org');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('redirects to the public address, not the internal host nginx forwards', async () => {
    mockStop.mockResolvedValue({ ok: true });
    // Behind nginx request.url carries the internal host.
    const request = new NextRequest('http://127.0.0.1:3000/api/donasi-rutin/berhenti/tok', { method: 'POST' });

    const res = await POST(request, { params: Promise.resolve({ token: 'tok' }) });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://fundforindonesia.org/donasi-rutin/berhenti/tok?selesai=1');
  });

  it('answers the same 404 for any refused token', async () => {
    mockStop.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), {
      params: Promise.resolve({ token: 'bad' }),
    });
    expect(res.status).toBe(404);
  });
});
