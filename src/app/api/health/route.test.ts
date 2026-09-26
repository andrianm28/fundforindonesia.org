import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: vi.fn() },
}));

import { prisma } from '@/lib/prisma';
import { GET, dynamic } from './route';

const mockQueryRaw = prisma.$queryRaw as unknown as Mock;

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 { ok: true } when the database answers', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns 503 { ok: false } with no error details when the database is down', async () => {
    mockQueryRaw.mockRejectedValue(
      new Error("Can't reach database server at postgres://app:s3cret@db:5432/ffi"),
    );

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ ok: false });
    expect(body).not.toContain('s3cret');
  });

  it('is never cached, whether the database is up or down', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const up = await GET();
    mockQueryRaw.mockRejectedValueOnce(new Error('down'));
    const down = await GET();

    expect(up.headers.get('Cache-Control')).toBe('no-store');
    expect(down.headers.get('Cache-Control')).toBe('no-store');
    expect(dynamic).toBe('force-dynamic');
  });
});
