import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /s/<code> (ticket E1/02; owner decision 2026-10-04: a prefix on the
 * apex domain). Redirects to the Campaign page on the public domain with
 * the link's Traffic Source as `?src=`, so a Donation made after it
 * records that source.
 */

vi.mock('@/lib/short-links', () => ({ followShortLink: vi.fn() }));

import { GET } from './route';
import { followShortLink } from '@/lib/short-links';

const mockFollow = followShortLink as unknown as Mock;

function call(code: string) {
  // Deliberately not the public host: the redirect must not follow the internal one behind nginx.
  return GET(new NextRequest(`http://127.0.0.1:3000/s/${code}`), { params: Promise.resolve({ code }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://fundforindonesia.org');
});

describe('GET /s/[code]', () => {
  it('redirects to the Campaign on the public domain, carrying the source', async () => {
    mockFollow.mockResolvedValue('/campaign/bantu-korban?src=whatsapp');

    const response = await call('Abc23xyz');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://fundforindonesia.org/campaign/bantu-korban?src=whatsapp');
    expect(mockFollow).toHaveBeenCalledWith('Abc23xyz', expect.any(Date));
  });

  it('is never cached, so every visit is counted and a closed Campaign stops redirecting', async () => {
    mockFollow.mockResolvedValue('/campaign/bantu-korban?src=whatsapp');

    expect((await call('Abc23xyz')).headers.get('cache-control')).toBe('no-store');
  });

  it('answers 404 for a code that leads nowhere', async () => {
    mockFollow.mockResolvedValue(null);

    const response = await call('Abc23xyz');

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Tautan tidak ditemukan');
  });

  it('answers 500 when the lookup fails', async () => {
    mockFollow.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await call('Abc23xyz')).status).toBe(500);
  });
});
