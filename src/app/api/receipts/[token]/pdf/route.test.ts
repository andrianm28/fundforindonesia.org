import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { receipt: { findUnique: vi.fn() } } }));

vi.mock('@/lib/rate-limit-guard', () => ({ guardRoute: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { guardRoute } from '@/lib/rate-limit-guard';
import { GET } from './route';

const findUnique = prisma.receipt.findUnique as unknown as ReturnType<typeof vi.fn>;

function receipt(donation: Record<string, unknown> = {}) {
  return {
    token: 'tok-1',
    createdAt: new Date('2026-09-26T10:00:00.000Z'),
    sentAt: null,
    donation: {
      amount: 250_000,
      guestName: null,
      anonymisedAt: null,
      donor: { name: 'Sari' },
      payments: [{ sandbox: false }],
      campaign: { title: 'Bantu Sekolah Yatim', collectingEntity: { name: 'YIEM' } },
      ...donation,
    },
  };
}

const call = (token: string) => GET(new Request('http://x'), { params: Promise.resolve({ token }) });

const guard = vi.mocked(guardRoute);

beforeEach(() => {
  guard.mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

describe('GET /api/receipts/[token]/pdf', () => {
  it('serves the PDF as a private attachment for a valid token', async () => {
    findUnique.mockResolvedValue(receipt());
    const res = await call('tok-1');
    expect(findUnique.mock.calls[0][0].where).toEqual({ token: 'tok-1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="bukti-donasi-tok-1.pdf"');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = Buffer.from(await res.arrayBuffer()).toString('latin1');
    expect(body.startsWith('%PDF-')).toBe(true);
    expect(body).toContain('Bantu Sekolah Yatim');
    expect(body).toContain('Sari');
  });

  it('returns the rate limiter refusal untouched, without reading the Receipt', async () => {
    guard.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 429, headers: { 'Retry-After': '120' } }));
    const res = await call('tok-1');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('counts per address under the receipt-pdf scope and fails open', async () => {
    findUnique.mockResolvedValue(receipt());
    await call('tok-1');
    expect(guard.mock.calls[0][0]).toMatchObject({ scope: 'receipt-pdf', onUnavailable: 'open' });
  });

  it('answers 404 for an unknown token', async () => {
    findUnique.mockResolvedValue(null);
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).not.toBe('application/pdf');
  });

  it('never prints the name of an anonymised Donor', async () => {
    findUnique.mockResolvedValue(receipt({ anonymisedAt: new Date(), donor: null, guestName: null }));
    const body = Buffer.from(await (await call('tok-1')).arrayBuffer()).toString('latin1');
    expect(body).toContain('Donor anonim');
    expect(body).not.toContain('Sari');
  });
});
