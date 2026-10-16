import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock prisma wholesale, same as the Payout request route's own tests. The
// fake tx below implements ledgerEntry.groupBy for real, so campaignBalance
// and escrowBalance (neither mocked) compute actual numbers from actual rows
// rather than being asserted on by call.
/**
 * A stand-in for the Prisma client that reports which `model.method` each call
 * went through, WITHOUT owning the call.
 *
 * It hands back the real `vi.fn()`, and `calls()` reads that mock's own
 * `.mock.calls`. That is the whole point. The obvious recorder -- a wrapper
 * whose body does `calls.push(...)` -- records nothing here, because the push
 * lives in the IMPLEMENTATION and `mockResolvedValue` / `mockImplementation`
 * REPLACE the implementation, which every `beforeEach` in this file does. The
 * wrapper's push stopped running the moment a test gave the mock an answer, so
 * not one `prisma.*` call was ever recorded, and `prisma.payment.findMany` --
 * the entry point of the sweep this file has to survive -- was invisible.
 * Returning the real mock is also the passthrough shape the rest of this repo
 * already uses (api/admin/verification-checklist/route.test.ts).
 */
const fake = vi.hoisted(() => {
  /** Enough of a vitest mock to ask whether it was called. */
  type Tracked = { mock: { calls: unknown[][] } };

  function wrap<T extends object>(target: T, path: string) {
    // `model.method` -> the real mock, overwritten on every access so a later
    // test's own client replaces an earlier one's rather than sharing it.
    const seen = new Map<string, Tracked>();

    const proxyOver = (object: object, prefix: string) =>
      new Proxy(object, {
        get(t, prop, receiver) {
          const value = Reflect.get(t, prop, receiver);
          if (typeof value === 'function') {
            seen.set(`${prefix}.${String(prop)}`, value as Tracked);
            // The real mock, not a wrapper around it: a test has to be able to
            // answer it, and the record read back is that mock's own.
            return value;
          }
          if (value !== null && typeof value === 'object') {
            return proxyOver(value, `${prefix}.${String(prop)}`);
          }
          return value;
        },
      });

    return {
      proxy: proxyOver(target, path) as T,
      /** Every `model.method` actually called, in the order it was first seen. */
      calls: () =>
        [...seen].filter(([, tracked]) => tracked.mock.calls.length > 0).map(([name]) => name),
    };
  }

  return {
    wrap,
    // No `payout` model: this GET's only Payout query is `tx.payout.findMany`,
    // inside the transaction, so a `prisma.payout` here would be fixture
    // plumbing rather than something the route could reach for.
    prisma: wrap(
      {
        campaign: { findUnique: vi.fn() },
        // The sweep's own entry point, answered but never reached from here.
        // It is a real candidate a sweep could claim, which is what makes "the
        // books did not move" a fact about this read and not about a fixture
        // that quietly stopped being releasable.
        payment: { findMany: vi.fn() },
        // `count` answers a second, narrower question than `findMany` above:
        // not which accounts are offered, but whether one that is NOT offered
        // exists at all, so the empty state can tell "never added one" from
        // "added one, still not verified" (ticket 17). The route only asks it
        // when the verified list is empty -- see the tests that assert it is
        // NOT called otherwise.
        bankAccount: { findMany: vi.fn(), count: vi.fn() },
        $transaction: vi.fn(),
      },
      'prisma',
    ),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: fake.prisma.proxy }));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from '@/lib/auth';
import { GET } from './route';
import { ledgerGroupBy } from '../../../../../../../tests/support/ledger-group-by';

const mockCampaignFindUnique = fake.prisma.proxy.campaign.findUnique as unknown as Mock;
const mockPaymentFindMany = fake.prisma.proxy.payment.findMany as unknown as Mock;
const mockBankAccountFindMany = fake.prisma.proxy.bankAccount.findMany as unknown as Mock;
const mockBankAccountCount = fake.prisma.proxy.bankAccount.count as unknown as Mock;
const mockTransaction = fake.prisma.proxy.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

/** The Payout rows a test wants this read to find. One source, so the fixture
 *  the query answers with is the fixture the assertions read. */
let payoutRows: Record<string, unknown>[] = [];

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
};

/** The columns `releaseMaturedEscrow` reads and stamps on a swept Payment. */
type PaymentRow = {
  id: string;
  amount: number;
  providerFee: number;
  status: string;
  escrowReleaseAt: Date;
  escrowReleasedAt: Date | null;
  donationId: string | null;
  registrationId: string | null;
  /**
   * The relation `releaseMaturedEscrow` reads to find which Campaign a
   * Payment's hold belongs to. Without it the sweep throws inside its
   * per-payment try/catch, logs, and moves nothing -- so a fixture without it
   * would leave "the books did not move" true for a read that DID sweep, which
   * is the green-for-the-wrong-reason this control exists to rule out.
   */
  donation: { campaignId: string } | null;
};

/**
 * Minimal in-memory stand-in for a transaction client, using the shared
 * ledgerEntry.groupBy simulation (tests/support/ledger-group-by.ts) so the
 * two balances are real sums over real rows.
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

function makeTx(options: { ledgerRows?: LedgerRow[]; payments?: PaymentRow[] } = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  // Mutable, because a write that really happens has to be visible afterwards:
  // `payment.updateMany` below is the claim releaseMaturedEscrow stamps its
  // escrowReleasedAt with, so a read that swept would leave this array changed.
  const payments: PaymentRow[] = [...(options.payments ?? [])];
  const tx = {
    campaign: { findUnique: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    // Answers from the same rows the payout assertions read, so a test sets
    // the Payout history once. Deliberately NOT a delegate to a `prisma.payout`
    // mock: that echo is fixture plumbing, and the recorder would name it as
    // though the route had reached for it.
    payout: {
      findMany: vi.fn(async (args: { select?: Record<string, boolean> }) =>
        payoutRows.map((row) => projected(row, args.select)),
      ),
    },
    payment: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<PaymentRow> }) => {
        const row = payments.find((p) => p.id === where.id && p.escrowReleasedAt === null);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
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
  };
  const tracked = fake.wrap(tx, 'tx');
  return { tx: tracked.proxy, rows, payments, reads: tracked.calls };
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

/**
 * A matured Escrow Hold on this Campaign, of the exact shape
 * releaseMaturedEscrow's predicate selects: PAID, past its release date, never
 * released. In the fixture rather than in the "moves no money" case alone so
 * that case has something a sweep COULD move -- an empty candidate list makes
 * "the books did not change" a fact about the fixture rather than about the
 * read, which is the same green-for-the-wrong-reason the case is being
 * rewritten to stop.
 *
 * A factory, not a constant, for the same reason the fake's `payments` array is
 * mutable: a sweep would stamp this row, and one case's stamp must not become
 * the next case's starting position.
 */
function maturedPayment(): PaymentRow {
  return {
    id: 'payment-1',
    amount: 500_000,
    providerFee: 5_000,
    status: 'PAID',
    escrowReleaseAt: new Date('2020-01-01T00:00:00.000Z'),
    escrowReleasedAt: null,
    donationId: 'donation-1',
    registrationId: null,
    donation: { campaignId: 'campaign-1' },
  };
}

/** The Escrow Hold row a release of the above would drain. */
const HELD_ESCROW: LedgerRow = {
  transactionId: 'settle-1',
  direction: 'CREDIT',
  amount: 500_000,
  account: 'ESCROW_HOLD',
  campaignId: 'campaign-1',
};

/**
 * Everything this GET is allowed to ask the database, and the whole of it.
 *
 * An allow-list, not a deny-list. Naming the three methods the previous
 * version of the "moves no money" case denied proved only that THOSE three
 * were unused, and releaseMaturedEscrow written with any other query shape
 * would have passed it. Naming what a read may ask for fails on whatever
 * appears instead, and the failure says what appeared.
 */
const READS_A_GET_MAY_MAKE = [
  'prisma.$transaction',
  'prisma.bankAccount.findMany',
  'prisma.campaign.findUnique',
  'tx.ledgerEntry.groupBy',
  'tx.payout.findMany',
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
    payoutRows = [];
    mockGetServerSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });
    mockCampaignFindUnique.mockResolvedValue(campaign());
    mockPaymentFindMany.mockResolvedValue([]);
    // Honours `where` and `select` the way the database and the real client
    // do, so "only the verified one comes back" is a property of the route's
    // query and not of a fake that returned whatever it liked.
    mockBankAccountFindMany.mockImplementation(
      async (args: { where?: Record<string, unknown>; select?: Record<string, boolean> }) =>
        BANK_ACCOUNTS.filter((row) => matches(row, args.where)).map((row) => projected(row, args.select)),
    );
    // Defaults to "none", so a test that never touches this fixture is a test
    // of the ordinary case (a verified account exists) where the route must
    // not call this at all -- see "does not ask ... when a verified account
    // already answers the question" below.
    mockBankAccountCount.mockResolvedValue(0);
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
    payoutRows = [
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
    ];
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();
    const body = await response.json();

    expect(body.payouts.map((p: { id: string }) => p.id)).toEqual(['payout-2', 'payout-1']);
    // A status the Fundraiser can act on: "waiting for an Admin" and "money
    // already moved" are different facts, not one grey "submitted".
    expect(body.payouts.map((p: { status: string }) => p.status)).toEqual(['APPROVED', 'COMPLETED']);
    // Scoped to this Campaign's own Payouts, so one Fundraiser never sees
    // another's money movements. Asserted on the query the route actually
    // issued, not on an echo of it inside the fake.
    expect(tx.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'campaign-1', sandbox: false } }),
    );
  });

  it("tells the Fundraiser which of their COMPLETED Payouts still need a Usage Report, or have a disputed one (ticket 22)", async () => {
    payoutRows = [
      // No Usage Report at all: blocks the next Payout.
      { id: 'payout-1', amount: 100_000, description: 'x', status: 'COMPLETED', createdAt: new Date('2026-09-01'), approvedAt: null, completedAt: new Date('2026-09-02'), usageReport: null },
      // Submitted and undisputed.
      { id: 'payout-2', amount: 100_000, description: 'x', status: 'COMPLETED', createdAt: new Date('2026-09-03'), approvedAt: null, completedAt: new Date('2026-09-04'), usageReport: { id: 'ur-2', disputedAt: null } },
      // Submitted but disputed: still blocks the next Payout.
      { id: 'payout-3', amount: 100_000, description: 'x', status: 'COMPLETED', createdAt: new Date('2026-09-05'), approvedAt: null, completedAt: new Date('2026-09-06'), usageReport: { id: 'ur-3', disputedAt: new Date('2026-09-07') } },
      // Not COMPLETED yet: no Usage Report question applies.
      { id: 'payout-4', amount: 100_000, description: 'x', status: 'APPROVED', createdAt: new Date('2026-09-08'), approvedAt: new Date('2026-09-08'), completedAt: null, usageReport: null },
    ];
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();
    const body = await response.json();

    const byId = Object.fromEntries(body.payouts.map((p: { id: string; usageReportStatus: unknown }) => [p.id, p.usageReportStatus]));
    expect(byId).toEqual({
      'payout-1': 'missing',
      'payout-2': 'submitted',
      'payout-3': 'disputed',
      'payout-4': null,
    });
  });

  it('shows WHEN a still-DRAFT Payout was last checked short, never the provider or the balance (ticket 30)', async () => {
    payoutRows = [
      // DRAFT with an unresolved short check: the Fundraiser sees the date.
      {
        id: 'payout-1',
        amount: 100_000,
        description: 'x',
        status: 'DRAFT',
        createdAt: new Date('2026-09-01'),
        approvedAt: null,
        completedAt: null,
        usageReport: null,
        balanceChecks: [{ checkedAt: new Date('2026-09-05T00:00:00.000Z') }],
      },
      // DRAFT, never checked: nothing to show.
      {
        id: 'payout-2',
        amount: 100_000,
        description: 'x',
        status: 'DRAFT',
        createdAt: new Date('2026-09-02'),
        approvedAt: null,
        completedAt: null,
        usageReport: null,
        balanceChecks: [],
      },
      // APPROVED with a check in its history: resolved by the status change
      // alone (owner decision 2026-09-28) -- shown as APPROVED, not as
      // "menunggu saldo penyedia".
      {
        id: 'payout-3',
        amount: 100_000,
        description: 'x',
        status: 'APPROVED',
        createdAt: new Date('2026-09-03'),
        approvedAt: new Date('2026-09-06'),
        completedAt: null,
        usageReport: null,
        balanceChecks: [{ checkedAt: new Date('2026-09-04T00:00:00.000Z') }],
      },
    ];
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();
    const body = await response.json();

    const byId = Object.fromEntries(
      body.payouts.map((p: { id: string; shortCheckedAt: string | null }) => [p.id, p.shortCheckedAt]),
    );
    expect(byId).toEqual({
      'payout-1': '2026-09-05T00:00:00.000Z',
      'payout-2': null,
      'payout-3': null,
    });
    // Never the provider name or the recorded balance, anywhere in the body.
    expect(JSON.stringify(body)).not.toMatch(/sumopod|recordedBalance|providerBalance/i);
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

  // Ticket 17: the empty picker is one screen for two different people -- one
  // who has never added an account, and one who added one that a Verifier has
  // not (yet, or ever) approved. Both currently see the exact same sentence
  // and neither is given a way out of it. `hasUnverifiedBankAccount` is the
  // one bit that lets the screen tell them apart; it answers nothing about
  // WHICH request failed or why, only "was there ever one to begin with".
  it("does not ask whether an unverified account exists when a verified one already answers the picker", async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const body = await (await read()).json();

    // The picker already has something to offer; asking a second question
    // whose answer the screen would not even render is a read with no
    // reader, and this is the query the allow-list tests above would not
    // have room for anyway.
    expect(mockBankAccountCount).not.toHaveBeenCalled();
    expect(body.hasUnverifiedBankAccount).toBe(false);
  });

  it("tells the picker no account was ever added, when the verified list is empty and there is nothing else on file", async () => {
    mockBankAccountFindMany.mockResolvedValue([]);
    mockBankAccountCount.mockResolvedValue(0);
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const body = await (await read()).json();

    expect(body.bankAccounts).toEqual([]);
    expect(body.hasUnverifiedBankAccount).toBe(false);
    // Asked of this owner alone, and of the accounts the picker itself is not
    // already showing -- `verifiedAt: null` rather than "not verified", since
    // a verified one would already be in `bankAccounts` and counting it twice
    // would make an account that IS offered read as a reason not to trust it.
    expect(mockBankAccountCount).toHaveBeenCalledWith({
      where: { ownerId: 'creator-1', verifiedAt: null },
    });
  });

  it("tells the picker an account was submitted but none is verified, when the verified list is empty but another exists", async () => {
    mockBankAccountFindMany.mockResolvedValue([]);
    mockBankAccountCount.mockResolvedValue(1);
    const { tx } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const body = await (await read()).json();

    expect(body.bankAccounts).toEqual([]);
    // This is the person a bare "belum ada rekening terverifikasi" sentence
    // misleads: they DID something, and the sentence alone reads as though
    // they had not.
    expect(body.hasUnverifiedBankAccount).toBe(true);
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
    const payment = maturedPayment();
    const { tx, rows, payments, reads } = makeTx({ ledgerRows: [HELD_ESCROW], payments: [payment] });
    // The sweep's candidate query returns the hold above, so a read that
    // released would find it, claim it and move it -- the negative control
    // that makes the assertions below a fact about this read.
    mockPaymentFindMany.mockResolvedValue([payment]);
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await read();

    expect(response.status).toBe(200);

    // The control is still a control: the fixture is still what a sweep
    // selects, so "the books did not move" stays a fact about this read rather
    // than about a fixture that quietly stopped being releasable.
    expect(payments.map((p) => [p.status, p.escrowReleasedAt, p.escrowReleaseAt < new Date()])).toEqual([
      ['PAID', null, true],
    ]);

    // THE BOOKS ARE UNCHANGED, which is the property itself and the part that
    // does not care how the code reached for them. Had this read swept, the
    // candidate would have been claimed (escrowReleasedAt stamped) and a pair
    // of legs posted (ESCROW_HOLD debited, CAMPAIGN_BALANCE credited); both
    // are visible here, whichever queries the sweep used to get there.
    expect(payments.map((p) => p.escrowReleasedAt)).toEqual([null]);
    expect(rows).toEqual([HELD_ESCROW]);

    // AND IT ASKED FOR NOTHING THAT IS NOT A READ. Together with the two
    // assertions above this closes the case the previous version of this test
    // left open: it pinned three method names, so a release written with any
    // other one would have kept it green. Anything a future change reaches for
    // shows up here by name instead.
    expect(
      [...fake.prisma.calls(), ...reads()].filter((call) => !READS_A_GET_MAY_MAKE.includes(call)),
    ).toEqual([]);

    // spec.md puts the release on a schedule (runScheduledJobs) and keeps the
    // lazy sweep as a SECOND path -- the one at the top of the Payout REQUEST
    // handler. A third path, taken every time a page is looked at, was never
    // asked for: it made how fast a Fundraiser's screen loaded a fact about
    // the books, and a read that can write cannot be replayed or reasoned
    // about as a read.
  });

  it("makes every read the allow-list names, so a recorder that had stopped recording would fail rather than pass", async () => {
    const { tx, reads } = makeTx();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    await read();

    // The other direction of the same contract the "moves no money" case
    // states, and the exact set rather than a subset: filtering recorded calls
    // against READS_A_GET_MAY_MAKE only proves something when the recorder is
    // recording, because an empty list passes every filter. A recorder whose
    // bodies stopped running turns that assertion into a green check that
    // proves nothing. Naming the calls that must be there makes the blindness
    // red instead -- and `prisma.*` are the names it is really about, since
    // those are the ones a wrapper-based recorder lost the moment a test
    // answered the mock. Exact, so a call left over from an earlier test is a
    // failure here too.
    expect([...fake.prisma.calls(), ...reads()].sort()).toEqual([...READS_A_GET_MAY_MAKE].sort());
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
    expect(tx.payout.findMany).not.toHaveBeenCalled();
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
