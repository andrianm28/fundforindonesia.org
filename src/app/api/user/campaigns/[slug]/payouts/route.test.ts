import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock prisma wholesale, same as the Payout request route's own tests. The
// fake tx below implements ledgerEntry.groupBy for real, so campaignBalance
// and escrowBalance (neither mocked) compute actual numbers from actual rows
// rather than being asserted on by call.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    payment: { findMany: vi.fn() },
    payout: { findMany: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { GET } from './route';

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockPaymentFindMany = prisma.payment.findMany as unknown as Mock;
const mockPayoutFindMany = prisma.payout.findMany as unknown as Mock;
const mockBankAccountFindMany = prisma.bankAccount.findMany as unknown as Mock;
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
 * Minimal in-memory stand-in for a transaction client, reusing the same
 * ledgerEntry.groupBy simulation as src/lib/money/ledger.test.ts so the two
 * balances are real sums over real rows.
 */
/**
 * Projects a mocked row down to the columns a query's `select` asked for, so
 * a fake that ignores `select` cannot make the route look like it returned
 * sealed columns it never asked for. Real Prisma does this; the assertion
 * that no ciphertext reaches the wire depends on it.
 */
function projected(row: Record<string, unknown>, select?: Record<string, boolean>) {
  if (!select) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => select[key]));
}

/** The slice of Prisma's `where` these fixtures need: equality and `not: null`. */
function matches(row: Record<string, unknown>, where?: Record<string, unknown>): boolean {
  return Object.entries(where ?? {}).every(([key, value]) =>
    value === null ? row[key] === null : value && typeof value === 'object' && 'not' in value
      ? row[key] !== ((value as { not: unknown }).not === null ? null : (value as { not: unknown }).not)
      : row[key] === value,
  );
}

function makeTx(options: { ledgerRows?: LedgerRow[] } = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  return {
    tx: {
      campaign: { findUnique: vi.fn() },
      bankAccount: { findMany: vi.fn() },
      // Delegates to the same module-level mock the route's sibling uses, so
      // a test sets the Payout rows once and both the transaction client and
      // the assertions about the query see the same thing.
      payout: {
        findMany: vi.fn(async (args: { select?: Record<string, boolean> }) =>
          ((await mockPayoutFindMany(args)) as Record<string, unknown>[]).map((row) => projected(row, args.select)),
        ),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      refund: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
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
    rows,
  };
}

/**
 * Two of this Fundraiser's own accounts, one verified and one not. The
 * unverified one is in the fixture rather than filtered out here so the
 * assertion that the query asks for verified accounts only is a real one:
 * a query that dropped the `verifiedAt` filter would return it.
 */
const BANK_ACCOUNTS = [
  {
    id: 'bank-1',
    ownerId: 'creator-1',
    bankCode: 'BCA',
    accountName: 'Creator One',
    accountNumberCiphertext: 'sealed-1234',
    accountNumberKeyId: 'enc-test-1',
    verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    id: 'bank-2',
    ownerId: 'creator-1',
    bankCode: 'BRI',
    accountName: 'Creator One',
    accountNumberCiphertext: 'sealed-5678',
    accountNumberKeyId: 'enc-test-1',
    verifiedAt: null,
  },
];

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-campaign' }) };
}

const read = () => GET(new Request('http://localhost:3000/api/user/campaigns/test-campaign/payouts'), routeContext());

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'campaign-1',
    slug: 'test-campaign',
    title: 'Sumur untuk Desa',
    creatorId: 'creator-1',
    isDemo: false,
    lifecycleStatus: 'ACTIVE',
    deadline: null,
    // The lifetime-raised display figure, which is NOT what may be paid out.
    // Large on purpose: a screen that read this instead of the ledger would
    // offer a Payout the server then refuses.
    collectedAmount: 9_000_000,
    ...overrides,
  };
}

describe("GET /api/user/campaigns/[slug]/payouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });
    mockCampaignFindUnique.mockResolvedValue(campaign());
    mockPaymentFindMany.mockResolvedValue([]);
    mockPayoutFindMany.mockResolvedValue([]);
    // Honours `where` and `select` the way the database and the real client
    // do, so "only the verified one comes back" is a property of the route's
    // query and not of a fake that returned whatever it liked.
    mockBankAccountFindMany.mockImplementation(
      async (args: { where?: Record<string, unknown>; select?: Record<string, boolean> }) =>
        BANK_ACCOUNTS.filter((row) => matches(row, args.where)).map((row) => projected(row, args.select)),
    );
  });

  it("shows the Fundraiser their Escrow Hold and their Campaign Balance as two separate figures, both from the ledger", async () => {
    const { tx } = makeTx({
      ledgerRows: [
        // Settled, still inside the hold.
        { transactionId: 'settle-1', direction: 'CREDIT', amount: 120_000, account: 'ESCROW_HOLD', campaignId: 'campaign-1' },
        // Already released, and not yet paid out.
        { transactionId: 'release-1', direction: 'CREDIT', amount: 800_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
        // Already instructed out to a Fundraiser: debited, so withdrawable is
        // 800.000 and not 1.400.000.
        { transactionId: 'payout-instructed-1', direction: 'DEBIT', amount: 600_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' },
      ],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.escrowHold).toBe(120_000);
    expect(body.campaignBalance).toBe(200_000);
    // Never the lifetime-raised display figure, which knows nothing about
    // escrow, refunds, or money already instructed out.
    expect(body.campaignBalance).not.toBe(9_000_000);
  });

  it("lists this Campaign's Payouts with the status each one is in, newest first, and nothing from another Campaign", async () => {
    mockPayoutFindMany.mockResolvedValue([
      {
        id: 'payout-2',
        amount: 200_000,
        description: 'Bahan bangunan',
        status: 'APPROVED',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
        approvedAt: new Date('2026-09-21T00:00:00.000Z'),
        completedAt: null,
      },
      {
        id: 'payout-1',
        amount: 100_000,
        description: 'Upah pekerja',
        status: 'COMPLETED',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        approvedAt: new Date('2026-09-02T00:00:00.000Z'),
        completedAt: new Date('2026-09-03T00:00:00.000Z'),
      },
    ]);
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();
    const body = await response.json();

    expect(body.payouts.map((p: { id: string }) => p.id)).toEqual(['payout-2', 'payout-1']);
    // A status the Fundraiser can act on: "waiting for an Admin" and "money
    // already moved" are different facts, not one grey "submitted".
    expect(body.payouts.map((p: { status: string }) => p.status)).toEqual(['APPROVED', 'COMPLETED']);
    // Scoped to this Campaign's own Payouts, so one Fundraiser never sees
    // another's money movements.
    expect(mockPayoutFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'campaign-1' } }),
    );
  });

  it("offers only this Fundraiser's own verified Bank Accounts as payout destinations", async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();
    const body = await response.json();

    // One of the two fixture accounts is verified; the unverified one is
    // never offered, so the form cannot build a request requestPayout would
    // refuse with BANK_ACCOUNT_NOT_ELIGIBLE.
    expect(body.bankAccounts.map((a: { id: string }) => a.id)).toEqual(['bank-1']);
    expect(body.bankAccounts[0]).toMatchObject({ id: 'bank-1', bankCode: 'BCA', accountName: 'Creator One' });
    // The account number is a ciphertext (ADR 0012) and the UI masks it, so
    // the wire carries only what the picker can show -- and the query names
    // ownership and verification, both of which the picker depends on.
    expect(JSON.stringify(body)).not.toContain('sealed-1234');
    expect(mockBankAccountFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'creator-1', verifiedAt: { not: null } } }),
    );
  });

  it("tells the screen which Campaign status it is reading, so the screen can judge the request itself", async () => {
    mockCampaignFindUnique.mockResolvedValue(
      campaign({ lifecycleStatus: 'SUSPENDED' }),
    );
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();
    const body = await response.json();

    // The link on the Campaign list is hidden for a Suspended Campaign, but a
    // Fundraiser who types this URL arrives anyway. Without the status in the
    // response the form cannot know, so they fill it in and only learn from the
    // refusal -- the request would have been made against a Campaign that
    // cannot pay out at all.
    expect(body.lifecycleStatus).toBe('SUSPENDED');
  });

  it("reads the EFFECTIVE status, the same one the money layer is judged on, not the stored column", async () => {
    // Stored ACTIVE with yesterday's deadline. The subject guard judges
    // requirePayoutAllowed on effectiveStatus, so a stored column would let
    // the screen offer a request the server refuses as Expired -- and the two
    // statuses also badge differently, so the screen would mislabel the
    // Campaign besides.
    mockCampaignFindUnique.mockResolvedValue(
      campaign({ lifecycleStatus: 'ACTIVE', deadline: new Date('2020-01-01T00:00:00.000Z') }),
    );
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const body = await (await read()).json();

    expect(body.lifecycleStatus).toBe('EXPIRED');
  });

  it("asks the database for the status and the deadline, and nothing else it would not answer", async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    await read();

    // `select` is a claim about which columns this read depends on, and the
    // two it now does are the status and the deadline behind it. A fake that
    // ignored `select` could otherwise hand this read a status it never asked
    // for, and the assertion above would pass for the wrong reason.
    expect(mockCampaignFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ lifecycleStatus: true, deadline: true }),
      }),
    );
  });

  it("moves no money: a screen the Fundraiser is only LOOKING at writes nothing to the ledger", async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();

    expect(response.status).toBe(200);
    // A GET is a read. Every payment lookup the Escrow release does starts at
    // prisma.payment.findMany, so an empty call list is the property itself:
    // this route writes no LedgerEntry, moves nothing out of ESCROW_HOLD, and
    // posts no transaction of its own.
    //
    // spec.md puts the release on a schedule (runScheduledJobs) and keeps the
    // lazy sweep as a SECOND path -- the one at the top of the Payout REQUEST
    // handler. A third path, taken every time a page is looked at, was never
    // asked for: it made how fast a Fundraiser's screen loaded a fact about
    // the books, and a read that can write cannot be replayed or reasoned
    // about as a read.
    expect(mockPaymentFindMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it("answers 401 to an anonymous reader and 403 to a signed-in stranger, reading nothing either way", async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    mockGetServerSession.mockResolvedValue(null);
    expect((await read()).status).toBe(401);

    // Not this Campaign's Fundraiser, whatever they hold: a balance, a Payout
    // history, and a list of payout destinations are none of a stranger's
    // business, and an Admin is no exception -- on a Campaign they own an
    // Admin is only its Fundraiser (CONTEXT.md, Capacity).
    mockGetServerSession.mockResolvedValue({ user: { id: 'a-stranger', assignments: ['ADMIN'] } });
    const refused = await read();

    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe('NOT_AUTHORIZED');
    expect(mockPayoutFindMany).not.toHaveBeenCalled();
    expect(mockBankAccountFindMany).not.toHaveBeenCalled();
  });

  it("tells a Demo Campaign's Fundraiser there is no money to withdraw, rather than showing them a zero balance they would read as a shortfall", async () => {
    mockCampaignFindUnique.mockResolvedValue(campaign({ isDemo: true }));
    const { tx } = makeTx({
      // Fixture data, not money: a Demo Campaign's collectedAmount came from a
      // seed file. There are no ledger rows behind it, which is the point.
      ledgerRows: [],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();
    const body = await response.json();

    expect(response.status).toBe(200);
    // Said by name, so the screen can say it by name. A bare 0 reads as
    // "the money has not arrived yet" and sends the Fundraiser looking for a
    // shortfall that does not exist (CONTEXT.md, Demo Campaign).
    expect(body.isDemo).toBe(true);
  });
});
