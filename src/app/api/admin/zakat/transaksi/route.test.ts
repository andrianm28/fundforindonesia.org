import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/** GET /api/admin/zakat/transaksi: the zakat transactions CSV, Admin-only, 404 while the module is OFF (ADR 0028). */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
const switchedOn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/operations', async (orig) => ({
  ...(await orig<typeof import('@/lib/operations')>()),
  zakatSwitchedOn: switchedOn,
}));
vi.mock('@/lib/zakat-report', async (orig) => ({
  ...(await orig<typeof import('@/lib/zakat-report')>()),
  zakatTransactions: vi.fn(),
}));

import { getServerSession } from '@/lib/auth';
import { zakatTransactions } from '@/lib/zakat-report';
import { InvalidRecapPeriodError } from '@/lib/money/finance-recap';
import { GET } from './route';

const session = vi.mocked(getServerSession) as unknown as ReturnType<typeof vi.fn>;
const req = (qs = '') => new NextRequest(`http://localhost/api/admin/zakat/transaksi${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  switchedOn.mockResolvedValue(true);
  vi.mocked(zakatTransactions).mockResolvedValue([]);
});

describe('GET /api/admin/zakat/transaksi', () => {
  it('is a 404 for everyone, an Admin and a signed-out visitor included, while the module is OFF', async () => {
    switchedOn.mockResolvedValue(false);
    session.mockResolvedValue({ user: { id: 'a', assignments: ['ADMIN'] } });
    expect((await GET(req())).status).toBe(404);
    session.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(404);
    expect(zakatTransactions).not.toHaveBeenCalled();
  });

  it('is a 404 for a signed-in non-Admin and a 401 when signed out, once the module is ON', async () => {
    session.mockResolvedValue({ user: { id: 'v', assignments: ['VERIFIER'] } });
    expect((await GET(req())).status).toBe(404);
    session.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(zakatTransactions).not.toHaveBeenCalled();
  });

  it('returns the CSV as a no-store attachment for an Admin, for the month asked', async () => {
    session.mockResolvedValue({ user: { id: 'a', assignments: ['ADMIN'] } });
    const res = await GET(req('?from=2026-10&to=2026-11'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('transaksi-zakat-2026-10_2026-11.csv');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(zakatTransactions).toHaveBeenCalledWith(expect.anything(), { from: '2026-10', to: '2026-11' });
    expect((await res.text()).startsWith('Tanggal (WIB),ID donasi')).toBe(true);
  });

  it('defaults to the current WIB month, and refuses a malformed period with 400', async () => {
    session.mockResolvedValue({ user: { id: 'a', assignments: ['ADMIN'] } });
    expect((await GET(req())).status).toBe(200);
    vi.mocked(zakatTransactions).mockRejectedValue(new InvalidRecapPeriodError('Periode "bukan-bulan" harus berformat YYYY-MM.'));
    expect((await GET(req('?from=bukan-bulan'))).status).toBe(400);
  });
});
