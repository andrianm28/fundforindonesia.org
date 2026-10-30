import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/money/finance-recap', async (orig) => ({
  ...(await orig<typeof import('@/lib/money/finance-recap')>()),
  financeRecap: vi.fn(),
}));

import { getServerSession } from '@/lib/auth';
import { financeRecap, emptyAmounts } from '@/lib/money/finance-recap';
import { GET } from './route';

const session = vi.mocked(getServerSession) as unknown as ReturnType<typeof vi.fn>;
const req = (qs = '') => new NextRequest(`http://localhost/api/admin/finance/recap${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(financeRecap).mockResolvedValue({ rows: [], totals: emptyAmounts() });
});

describe('GET /api/admin/finance/recap', () => {
  it('is a 404 for a signed-in non-Admin and reads nothing', async () => {
    session.mockResolvedValue({ user: { id: 'u', assignments: ['VERIFIER'] } });
    expect((await GET(req())).status).toBe(404);
    expect(financeRecap).not.toHaveBeenCalled();
  });

  it('is a 401 when signed out', async () => {
    session.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it('returns the CSV as an attachment for an Admin', async () => {
    session.mockResolvedValue({ user: { id: 'a', assignments: ['ADMIN'] } });
    const res = await GET(req('?from=2026-09&to=2026-10'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('rekap-keuangan-2026-09_2026-10.csv');
    expect(financeRecap).toHaveBeenCalledWith(expect.anything(), { from: '2026-09', to: '2026-10' });
    expect((await res.text()).startsWith('Periode,Jenis,Campaign')).toBe(true);
  });

  it('answers 400 for a bad period', async () => {
    session.mockResolvedValue({ user: { id: 'a', assignments: ['ADMIN'] } });
    const { InvalidRecapPeriodError } = await import('@/lib/money/finance-recap');
    vi.mocked(financeRecap).mockRejectedValue(new InvalidRecapPeriodError('Periode salah'));
    expect((await GET(req('?from=x'))).status).toBe(400);
  });
});
