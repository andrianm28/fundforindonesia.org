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
    payment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { ledgerGroupBy } from '../../../../../../tests/support/ledger-group-by';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPaymentFindMany = prisma.payment.findMany as unknown as Mock;
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
 * Minimal in-memory stand-in for the transaction client, using the shared
 * ledgerEntry.groupBy simulation (tests/support/ledger-group-by.ts) so
 * campaignBalance computes a real number from real rows instead of a
 * hand-fed one.
 *
 * Also backs releaseMaturedEscrow's own transaction (payment.updateMany,
 * $queryRaw) with the same `rows` array bankAccount/payout use -- both
 * mockTransaction.mockImplementation((cb) => cb(tx)) calls in these tests
 * share the one `tx`, so a release posted by the sweep is visible to the
 * balance check requestPayout makes right after it.
 */
function makeTx(options: {
  ledgerRows?: LedgerRow[];
  bankAccount?: Record<string, unknown> | null;
  payoutCreate?: (data: unknown) => Record<string, unknown>;
  paymentState?: Map<string, { escrowReleasedAt: Date | null }>;
  isDemo?: boolean;
  /** The Campaign's stored status, read by the subject guard under its lock. */
  lifecycleStatus?: string;
} = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const bankAccountFindUnique = vi.fn().mockResolvedValue(options.bankAccount ?? null);
  const payoutCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
    options.payoutCreate ? options.payoutCreate(data) : { id: 'payout-1', createdAt: new Date(), ...data },
  );
  const paymentState = options.paymentState ?? new Map<string, { escrowReleasedAt: Date | null }>();
  return {
    tx: {
      // requestPayout's very first check, ahead of the bank account lookup
      // -- not demo by default, so every existing test in this file exercises
      // the checks it actually targets rather than tripping this one.
      campaign: {
        findUnique: vi.fn().mockResolvedValue({
          creatorId: 'creator-1',
          isDemo: options.isDemo ?? false,
          lifecycleStatus: options.lifecycleStatus ?? 'ACTIVE',
          deadline: null,
        }),
      },
      bankAccount: { findUnique: bankAccountFindUnique },
      payout: { create: payoutCreate },
      payment: {
        updateMany: vi.fn(async ({ where, data }: { where: { id: string; escrowReleasedAt: null }; data: Record<string, unknown> }) => {
          const row = paymentState.get(where.id);
          if (!row || row.escrowReleasedAt !== where.escrowReleasedAt) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      // No refunds in any of these tests -- releaseMaturedEscrow's per-payment
      // cap (src/lib/money/escrow.ts) reads this to find out how much of a
      // payment's net has already gone back to a donor.
      refund: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(ledgerGroupBy(rows)),
      },
    },
    bankAccountFindUnique,
    payoutCreate,
    rows,
    paymentState,
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
      user: { id: 'creator-1', assignments: [] },
    });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1', creatorId: 'creator-1' });
    // No matured escrow holds by default -- releaseMaturedEscrow (called at
    // the top of the handler, before requestPayout) finds nothing and
    // prisma.$transaction is never reached on its account. Tests exercising
    // the release itself override this.
    mockPaymentFindMany.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 NOT_AUTHORIZED when the caller is not this campaign\'s creator, whatever their Role', async () => {
    // Ownership, asked of the Capacity judgement, is the only gate: a Role
    // (even the legacy CAMPAIGN_CREATOR one) grants nothing here.
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else' } });
    const response = await POST(createRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Fundraiser Campaign ini yang dapat melakukan tindakan ini.',
      code: 'NOT_AUTHORIZED',
    });
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

  it('rejects a demo campaign with 403 by name, before the bank account is even looked up, and creates nothing', async () => {
    const { tx, bankAccountFindUnique, payoutCreate } = makeTx({
      bankAccount: verifiedBankAccount(),
      isDemo: true,
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(VALID_BODY), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    // Not "saldo tidak mencukupi" -- a demo campaign has no balance either,
    // but that message sends an operator hunting for money that was never
    // there. This must say what is actually true.
    expect(data.code).toBe('DEMO_CAMPAIGN');
    expect(bankAccountFindUnique).not.toHaveBeenCalled();
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it.each(['SUSPENDED', 'CANCELLED'])(
    'answers 409 PAYOUT_NOT_ALLOWED_FOR_STATUS for a %s Campaign and creates nothing',
    async (lifecycleStatus) => {
      const ledgerRows: LedgerRow[] = [
        { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
      ];
      const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows, lifecycleStatus });
      mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      const response = await POST(createRequest(VALID_BODY), routeContext());
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('PAYOUT_NOT_ALLOWED_FOR_STATUS');
      expect(payoutCreate).not.toHaveBeenCalled();
    },
  );

  it('rejects an unverified bank account with 403 and creates nothing', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount({ verifiedAt: null }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(VALID_BODY), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('BANK_ACCOUNT_NOT_ELIGIBLE');
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('rejects a bank account owned by someone else, even if verified, with 403', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount({ ownerId: 'a-stranger' }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('BANK_ACCOUNT_NOT_ELIGIBLE');
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('rejects a bank account that does not exist with 403', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: null });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('BANK_ACCOUNT_NOT_ELIGIBLE');
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
    expect(data.code).toBe('INSUFFICIENT_BALANCE');
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('lets the owner, with no Role or assignment, create a DRAFT payout and posts nothing to the ledger when the balance covers it', async () => {
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

  it('releases a matured escrow hold for this campaign before checking the withdrawable balance', async () => {
    // There is no scheduler anywhere in this repo -- this is the test that
    // proves releaseMaturedEscrow actually runs at the top of this handler.
    // Without the call in route.ts, this payout would be refused: the
    // campaign's only money is still sitting in ESCROW_HOLD, so
    // campaignBalance (CAMPAIGN_BALANCE only) would read 0.
    mockPaymentFindMany.mockResolvedValue([
      {
        id: 'payment-1',
        amount: 100_000,
        providerFee: 0,
        donationId: 'donation-1',
        registrationId: null,
        donation: { campaignId: 'campaign-1' },
        registration: null,
      },
    ]);
    const paymentState = new Map([['payment-1', { escrowReleasedAt: null as Date | null }]]);
    const { tx, payoutCreate, rows } = makeTx({
      bankAccount: verifiedBankAccount(),
      ledgerRows: [
        { transactionId: 'settle-1', direction: 'CREDIT', amount: 100_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1' },
      ],
      paymentState,
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest({ ...VALID_BODY, amount: 100_000 }), routeContext());

    expect(response.status).toBe(201);
    expect(payoutCreate).toHaveBeenCalled();
    // The release itself happened: the payment is stamped and its net
    // amount moved from ESCROW_HOLD to CAMPAIGN_BALANCE, which is what made
    // the balance check above pass.
    expect(paymentState.get('payment-1')!.escrowReleasedAt).not.toBeNull();
    const releaseLegs = rows.filter((r: LedgerRow) => r.transactionId === 'escrow-release:payment-1');
    expect(releaseLegs).toHaveLength(2);
    expect(releaseLegs.find((r: LedgerRow) => r.direction === 'DEBIT')).toMatchObject({
      account: 'ESCROW_HOLD',
      amount: 100_000,
    });
    expect(releaseLegs.find((r: LedgerRow) => r.direction === 'CREDIT')).toMatchObject({
      account: 'CAMPAIGN_BALANCE',
      amount: 100_000,
    });
  });
});
