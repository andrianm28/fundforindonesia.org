import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Recording a withdrawal from a Payment Provider to a Collection Account
 * (prd-compliance 35; PRD FFI-07; ADR 0011).
 *
 * The seam an Admin actually meets: the route is the only thing that decides who
 * may record one, and it must be the ADMIN assignment alone. The journal is not
 * asserted here -- the service test drives the real ledger for that -- so what
 * this file checks is the gate, the shape of what is passed down, and the fact
 * that a refusal writes nothing.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => {
  const tx = {
    providerWithdrawal: { create: vi.fn() },
    partnerOrganisation: { findUnique: vi.fn() },
    ledgerEntry: { createMany: vi.fn() },
  };
  return { prisma: { ...tx, $transaction: (fn: (client: unknown) => unknown) => fn(tx) } };
});

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockCreate = prisma.providerWithdrawal.create as unknown as Mock;
const mockEntityFind = prisma.partnerOrganisation.findUnique as unknown as Mock;
const mockCreateMany = prisma.ledgerEntry.createMany as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/provider-withdrawals';

const VALID = {
  provider: 'sumopod',
  reference: 'SP-2026-09-30-001',
  amount: 750_000,
  destinationName: 'Yayasan Sehat Mandiri',
  collectingEntityId: 'org-1',
  providerBalanceBefore: 1_200_000,
  providerBalanceAfter: 450_000,
  proofReference: 'dokumen/sweep-001.pdf',
};

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/admin/provider-withdrawals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCreate.mockImplementation(async ({ data }) => ({ id: 'pw-1', recordedAt: new Date('2026-09-30T00:00:00Z'), ...data }));
    mockEntityFind.mockResolvedValue({ id: 'org-1' });
    mockCreateMany.mockResolvedValue({ count: 2 });
  });

  it('answers 401 with no session, and 403 without the ADMIN assignment', async () => {
    // The sweep moves the platform's own money, which is squarely in the Admin's
    // remit in CONTEXT.md. A Verifier checks documents and does not move money,
    // exactly as with a Payout approval.
    mockSession.mockResolvedValue(null);
    expect((await post(VALID)).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await post(VALID)).status).toBe(403);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('records the sweep and posts the journal, answering 201 with the row', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      withdrawal: { id: 'pw-1', provider: 'sumopod', amount: 750_000 },
    });
    // The journal really is posted here, and it is a movement between two
    // different accounts: out of the Provider Balance, into the bank.
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    expect(mockCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ account: 'COLLECTION_ACCOUNT', direction: 'DEBIT', amount: 750_000 }),
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 750_000 }),
    ]);
  });

  it('records the Admin who did it, from the session and never from the body', async () => {
    await post({ ...VALID, recordedById: 'someone-else' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recordedById: 'admin-1' }) }),
    );
  });

  it('passes the two dashboard readings through untouched, because the gap between them is the finding', async () => {
    // The provider charged a fee on the transfer, so its balance fell by more
    // than was swept. The route does not reconcile that here and must not
    // "fix" it: the reading is stored as read, and the gap is reported.
    await post({ ...VALID, providerBalanceAfter: 430_000 });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerBalanceBefore: 1_200_000, providerBalanceAfter: 430_000 }),
      }),
    );
  });

  it('refuses a sweep with no provider named, and writes nothing', async () => {
    const res = await post({ ...VALID, provider: '  ' });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('PROVIDER_WITHDRAWAL_INVALID');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('refuses a sweep with no evidence, and writes nothing', async () => {
    const res = await post({ ...VALID, proofReference: '' });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('PROVIDER_WITHDRAWAL_PROOF_REQUIRED');
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('refuses an amount that is not whole rupiah above zero, and writes nothing', async () => {
    for (const amount of [0, -1, 1000.5]) {
      const res = await post({ ...VALID, amount });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('PROVIDER_WITHDRAWAL_AMOUNT_INVALID');
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a negative provider reading, because a negative balance describes nothing', async () => {
    const res = await post({ ...VALID, providerBalanceBefore: -1 });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('PROVIDER_WITHDRAWAL_AMOUNT_INVALID');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a collecting entity that is not registered, answering 404 with its own code', async () => {
    mockEntityFind.mockResolvedValue(null);

    const res = await post({ ...VALID, collectingEntityId: 'org-nope' });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('PROVIDER_WITHDRAWAL_ENTITY_NOT_FOUND');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a second recording of the same provider reference with 409, and posts nothing for it', async () => {
    // The provider issues one reference per disbursement, so this is the same
    // money being claimed twice. 409 rather than 400: it is a conflict with the
    // row that already holds the reference, and no retry fixes it.
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const res = await post(VALID);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PROVIDER_WITHDRAWAL_DUPLICATE');
    // The journal is posted after the claim, so a refused claim posts nothing.
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a JSON object at all', async () => {
    const res = await POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(['sumopod']) }));

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
