import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: vi.fn(), payment: { count: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { GET } from './route';

const queryRaw = prisma.$queryRaw as unknown as Mock;
const count = prisma.payment.count as unknown as Mock;

describe('GET /api/health/deep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports db ok and the stale PENDING payment count', async () => {
    queryRaw.mockResolvedValue([{}]);
    count.mockResolvedValue(3);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true, payments: { pendingOver24h: 3 } });
    const where = count.mock.calls[0][0].where;
    expect(where.status).toBe('PENDING');
    const ageMs = Date.now() - where.createdAt.lt.getTime();
    expect(Math.abs(ageMs - 24 * 3600 * 1000)).toBeLessThan(5000);
  });

  it('is 503 with no details when the database is down', async () => {
    queryRaw.mockRejectedValue(new Error('postgres://app:s3cret@db:5432/ffi unreachable'));
    const res = await GET();
    const body = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ ok: false, db: false });
    expect(body).not.toContain('s3cret');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('stays 200 with a null count when only the count query fails', async () => {
    queryRaw.mockResolvedValue([{}]);
    count.mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).payments.pendingOver24h).toBeNull();
  });
});
