import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { Kind } from '@/generated/prisma/client';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payment: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPaymentFindUnique = prisma.payment.findUnique as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

function makeTx(options: { ledgerRows?: LedgerRow[]; isDemo?: boolean; campaignCreatorId?: string; priorRefunds?: Array<{ amount: number; status: string }>; kind?: Kind } = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const refundCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'refund-1', createdAt: new Date(), ...data }));
  return {
    tx: {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'payment-1' }]),
      payment: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'payment-1',
          amount: 100_000,
          providerFee: 5_000,
          escrowReleasedAt: null,
          donation: { campaignId: 'campaign-1' },
          registration: null,
        }),
      },
      campaign: {
        // The Campaign row lockAndLoad reads (src/lib/subject-guard.ts). Every
        // test that does not name a Kind gets DONATION explicitly, rather than
        // leaving it undefined: `kind` is NOT NULL in the schema, so a row with
        // no Kind can only ever mean a test mock that fell behind the select --
        // and createRefund fails closed on it, refusing requests these tests
        // expect to succeed. Defaulting it here is what makes those two tests
        // green for the right reason, and the last two tests below pin that
        // this field is what decides.
        findUnique: vi.fn().mockResolvedValue({
          isDemo: options.isDemo ?? false,
          creatorId: options.campaignCreatorId ?? 'fundraiser-1',
          kind: options.kind ?? Kind.DONATION,
        }),
      },
      refund: { create: refundCreate, findMany: vi.fn().mockResolvedValue(options.priorRefunds ?? []) },
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    },
    refundCreate,
    rows,
  };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/campaigns/test-campaign/refunds', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-campaign' }) };
}

const VALID_BODY = { paymentId: 'payment-1', amount: 40_000, reason: 'Dibayar dua kali' };

describe('POST /api/campaigns/[slug]/refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCampaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
    mockPaymentFindUnique.mockResolvedValue({ id: 'payment-1', donation: { campaignId: 'campaign-1' } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', assignments: ['VERIFIER'] } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body without ever resolving the campaign', async () => {
    const response = await POST(postRequest({ paymentId: '', amount: -5, reason: '' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockCampaignFindUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the campaign does not exist', async () => {
    mockCampaignFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
  });

  it("returns 404 when the Payment's Donation belongs to a different Campaign than the URL slug", async () => {
    mockPaymentFindUnique.mockResolvedValue({ id: 'payment-1', donation: { campaignId: 'a-different-campaign' } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the paymentId does not exist at all', async () => {
    mockPaymentFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('creates a REQUESTED Refund and returns 201 when everything checks out', async () => {
    const { tx, refundCreate } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.status).toBe('REQUESTED');
    expect(refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-1', amount: 40_000, requestedById: 'admin-1' }) }),
    );
  });

  it('returns 403 for a demo Campaign, creating nothing', async () => {
    const { tx, refundCreate } = makeTx({ isDemo: true });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('DEMO_CAMPAIGN');
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it("returns 403 OWN_CAMPAIGN_CONFLICT when the Admin is the Campaign's own Fundraiser, creating nothing", async () => {
    const { tx, refundCreate, rows } = makeTx({ campaignCreatorId: 'admin-1' });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT', error: expect.stringContaining('harus dilakukan Admin lain') });
    expect(refundCreate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('returns 400 when the requested amount exceeds what is still refundable', async () => {
    const { tx, refundCreate } = makeTx({ priorRefunds: [{ amount: 90_000, status: 'REQUESTED' }] });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest({ ...VALID_BODY, amount: 20_000 }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('REFUND_EXCEEDS_REMAINING');
    expect(refundCreate).not.toHaveBeenCalled();
  });

  /**
   * The harness's own half of the per-Kind rule, which
   * src/__tests__/integration/refund-kind-gate.test.ts cannot cover: that file
   * mocks `createRefund` away, so it proves how the route maps the refusal
   * without ever running the gate. Nothing else here pins that the Kind on
   * these mocked rows is READ, and it was read by nothing until the two
   * failures above: a mock missing `kind` failed closed and turned passing
   * tests red, and the mirror risk -- a mock whose Kind no longer decides
   * anything -- is silent either way. These two tests close both directions.
   */
  it('reads the Kind off the mocked Campaign row: the identical request is 201 on DONATION and 403 on zakat (PRD 196)', async () => {
    // One request body, one reason, one Payment -- only the Campaign's Kind
    // differs. Neither half can pass on its own, so the pair holds only if the
    // gate is really being fed this mock's `kind`.
    const donation = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(donation.tx));
    const allowed = await POST(postRequest(VALID_BODY), routeContext());
    expect(allowed.status).toBe(201);

    const zakat = makeTx({ kind: Kind.ZAKAT });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(zakat.tx));
    const refused = await POST(postRequest(VALID_BODY), routeContext());

    // Refused before any Refund row and before any freeze leg, not after: the
    // gate runs ahead of the refundable-cap check in createRefund.
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe('REFUND_NOT_ALLOWED_FOR_KIND');
    expect(zakat.refundCreate).not.toHaveBeenCalled();
    expect(zakat.rows).toHaveLength(0);
  });

  it('refuses a Campaign row whose Kind went missing, rather than reading it as an ordinary Campaign', async () => {
    // `kind` is NOT NULL, so this row can only come from a test mock that fell
    // behind lockAndLoad's select -- the exact shape that made the two tests
    // above fail. It must refuse loudly here, so the next mock to drop the
    // field is a red test rather than a silently permitted Refund on a zakat.
    const { tx, refundCreate, rows } = makeTx();
    tx.campaign.findUnique.mockResolvedValue({ isDemo: false, creatorId: 'fundraiser-1' });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('REFUND_NOT_ALLOWED_FOR_KIND');
    expect(refundCreate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});
