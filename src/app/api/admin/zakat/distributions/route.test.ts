import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /api/admin/zakat/distributions: the Admin's record of zakat distributed to
 * mustahik (PKS pemenuhan 19, ADR 0028). Admin-only; a 404 for everyone while
 * the module is OFF; a record only, so it never reaches the ledger or Payouts.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
const switchedOn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/operations', async (orig) => ({
  ...(await orig<typeof import('@/lib/operations')>()),
  zakatSwitchedOn: switchedOn,
  resolveOperations: vi.fn().mockResolvedValue({ zakat: { enabled: true, nisabAmount: 1, recipientOrganisationId: 'org-1' } }),
}));
vi.mock('@/lib/zakat-distributions', async (orig) => ({
  ...(await orig<typeof import('@/lib/zakat-distributions')>()),
  recordZakatDistribution: vi.fn(),
  listZakatDistributions: vi.fn(),
  zakatPosition: vi.fn(),
}));

import { getServerSession } from '@/lib/auth';
import {
  InvalidZakatDistributionError,
  ZakatDistributionExceedsReceivedError,
  listZakatDistributions,
  recordZakatDistribution,
  zakatPosition,
} from '@/lib/zakat-distributions';
import { GET, POST } from './route';

const session = vi.mocked(getServerSession) as unknown as ReturnType<typeof vi.fn>;
const ADMIN = { user: { id: 'admin-1', assignments: ['ADMIN'] } };
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/zakat/distributions', { method: 'POST', body: JSON.stringify(body) }));
const get = () => GET(new NextRequest('http://localhost/api/admin/zakat/distributions'));

beforeEach(() => {
  vi.clearAllMocks();
  switchedOn.mockResolvedValue(true);
  session.mockResolvedValue(ADMIN);
  vi.mocked(zakatPosition).mockResolvedValue({ received: 3_000_000, distributed: 1_000_000, remaining: 2_000_000 });
  vi.mocked(listZakatDistributions).mockResolvedValue([] as never);
  vi.mocked(recordZakatDistribution).mockResolvedValue({ id: 'z1' } as never);
});

describe('/api/admin/zakat/distributions', () => {
  it('is a 404 for everyone while the module is OFF, and records nothing', async () => {
    switchedOn.mockResolvedValue(false);
    expect((await get()).status).toBe(404);
    expect((await post({})).status).toBe(404);
    expect(recordZakatDistribution).not.toHaveBeenCalled();
  });

  it('is a 404 for a signed-in non-Admin, and records nothing', async () => {
    session.mockResolvedValue({ user: { id: 'v', assignments: ['VERIFIER'] } });
    expect((await get()).status).toBe(404);
    expect((await post({ amount: 1 })).status).toBe(404);
    expect(recordZakatDistribution).not.toHaveBeenCalled();
  });

  it('lets an Admin read the position and the records', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      position: { received: 3_000_000, distributed: 1_000_000, remaining: 2_000_000 },
      distributions: [],
    });
  });

  it('records a distribution as the acting Admin and answers 201', async () => {
    const input = { amount: 500_000, asnaf: 'FAKIR', distributedAt: '2026-11-08', recipientSummary: '25 keluarga' };
    const res = await post(input);

    expect(res.status).toBe(201);
    expect(recordZakatDistribution).toHaveBeenCalledWith(expect.anything(), { actorId: 'admin-1', input });
  });

  it.each([
    ['invalid input', new InvalidZakatDistributionError('Nominal penyaluran harus bilangan bulat rupiah, minimal Rp1.'), 400],
    ['more than was received', new ZakatDistributionExceedsReceivedError(10_000), 409],
  ])('answers the refusal for %s with its status and message, and does not 500', async (_why, error, status) => {
    vi.mocked(recordZakatDistribution).mockRejectedValue(error);
    const res = await post({ amount: 1 });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error.message);
  });

  it('refuses a body that is not a JSON object with 400', async () => {
    const res = await POST(new NextRequest('http://localhost/api/admin/zakat/distributions', { method: 'POST', body: 'bukan json' }));
    expect(res.status).toBe(400);
    expect(recordZakatDistribution).not.toHaveBeenCalled();
  });
});
