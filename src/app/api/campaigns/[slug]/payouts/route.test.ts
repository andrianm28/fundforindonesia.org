import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

// Mock prisma wholesale, same as the webhook route's tests. The fake tx below
// implements ledgerEntry.groupBy for real, so campaignBalance (not mocked)
// actually runs against it -- these tests assert on what requestPayout
// decided, not on whether some function was merely called.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
};

/**
 * Minimal in-memory stand-in for the transaction client, reusing the same
 * ledgerEntry.groupBy simulation as src/lib/money/ledger.test.ts so
 * campaignBalance computes a real number from real rows instead of a
 * hand-fed one.
 */
function makeTx(options: {
  ledgerRows?: LedgerRow[];
  bankAccount?: Record<string, unknown> | null;
  payoutCreate?: (data: unknown) => Record<string, unknown>;
} = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const bankAccountFindUnique = vi.fn().mockResolvedValue(options.bankAccount ?? null);
  const payoutCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
    options.payoutCreate ? options.payoutCreate(data) : { id: 'payout-1', createdAt: new Date(), ...data },
  );
  return {
    tx: {
      bankAccount: { findUnique: bankAccountFindUnique },
      payout: { create: payoutCreate },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
          const filtered = rows.filter((r) => {
            const w = args.where ?? {};
            return Object.entries(w).every(([k, v]) => (r as never as Record<string, unknown>)[k] === v);
          });
          const buckets = new Map<string, { row: Record<string, unknown>; sum: number }>();
          for (const r of filtered) {
            const key = args.by.map((k) => String((r as never as Record<string, unknown>)[k])).join('|');
            const b = buckets.get(key) ?? {
              row: Object.fromEntries(args.by.map((k) => [k, (r as never as Record<string, unknown>)[k]])),
              sum: 0,
            };
            b.sum += r.amount;
            buckets.set(key, b);
          }
          return Array.from(buckets.values()).map((b) => ({ ...b.row, _sum: { amount: b.sum } }));
        }),
      },
    },
    bankAccountFindUnique,
    payoutCreate,
  };
}

function verifiedBankAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bank-1',
    ownerId: 'creator-1',
    bankCode: 'BCA',
    accountNumber: '1234567890',
    accountName: 'Creator One',
    verifiedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/payouts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-campaign' }) };
}

const VALID_BODY = { bankAccountId: 'bank-1', amount: 100_000, description: 'Pencairan dana' };

describe('POST /api/campaigns/[slug]/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'creator-1', role: 'CAMPAIGN_CREATOR' },
    });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a role below CAMPAIGN_CREATOR', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'donor-1', role: 'DONOR' } });
    const response = await POST(createRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is a CAMPAIGN_CREATOR but not this campaign\'s creator', async () => {
    // withRoleCheck only proves "a campaign creator", not "this campaign's
    // creator" -- it does not pass the session to the handler, so this must
    // be enforced explicitly against the campaign actually resolved.
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await POST(createRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body without ever resolving the campaign', async () => {
    const response = await POST(createRequest({ bankAccountId: '', amount: -5, description: '' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockCampaignFindUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
  });

  it('rejects an unverified bank account with 403 and creates nothing', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount({ verifiedAt: null }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(VALID_BODY), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/terverifikasi|rekening/i);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('rejects a bank account owned by someone else, even if verified, with 403', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount({ ownerId: 'a-stranger' }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('rejects a bank account that does not exist with 403', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('rejects an amount over the withdrawable balance with 400, checked against the ledger not collectedAmount', async () => {
    // No CAMPAIGN_BALANCE ledger rows at all -- campaignBalance is 0 -- even
    // though a Campaign.collectedAmount field elsewhere might say otherwise.
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows: [] });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest({ ...VALID_BODY, amount: 1 }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/saldo/i);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('creates a DRAFT payout and posts nothing to the ledger when the balance covers it', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 100_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest({ ...VALID_BODY, amount: 100_000 }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.status).toBe('DRAFT');
    expect(payoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: 'campaign-1',
          bankAccountId: 'bank-1',
          amount: 100_000,
          requestedById: 'creator-1',
          status: 'DRAFT',
        }),
      }),
    );
    // Request posts nothing yet -- a DRAFT is a proposal, not a movement.
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });
});
