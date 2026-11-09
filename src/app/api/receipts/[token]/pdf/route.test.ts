import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { receipt: { findUnique: vi.fn() } } }));

import { prisma } from '@/lib/prisma';
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
