/**
 * ONE RULE, THREE CALLERS.
 *
 * `exceedsPayoutBalance` (src/lib/payout-balance-rule.ts) is the whole of the
 * Payout cap: how much of a balance a single Payout may ask for. Three pieces
 * of code have an opinion about it:
 *
 *   1. requestPayout, which creates the request;
 *   2. approvePayout, which spends the balance and is the one where money
 *      actually leaves -- the most authoritative of the three, and the one that
 *      re-reads the balance under the subject's row lock;
 *   3. CampaignPayoutPanel, which warns a Fundraiser before they submit.
 *
 * A second copy of the comparison in any of them is a defect whether or not it
 * happens to agree with the others today: a cap tightened in one place is a
 * screen offering an amount the server refuses, or a server refusing an amount
 * a screen has stopped warning about. So this file makes that impossible to do
 * quietly, in two halves that fail for different reasons.
 *
 * STRUCTURAL (the first case). The rule module is replaced by a spy and made to
 * answer something its own comparison never would -- "yes, this amount is over
 * the balance", for an amount far inside it. A caller that asks the rule
 * follows it; a caller that wrote its own comparison does not, and the case
 * says which. This is the half that catches `payout.amount > balance` written
 * out inside approvePayout while its two siblings use the module.
 *
 * BEHAVIOURAL (the second case). With the real rule in place, the money layer
 * and the screen are each asked about a spread of amounts around the boundary
 * and each is compared against the rule itself. It stays green through any
 * refactor that did not change what a Fundraiser may ask for, and goes red
 * when one of the three stops agreeing with the other two.
 *
 * The server remains the holder of the decision; the panel only warns. What is
 * pinned here is that the warning and the refusal cannot come to differ.
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * The rule module, replaced by a delegating spy. `real` is the genuine
 * comparison, kept so a case can state its expectation from the rule rather
 * than from the spy standing in for it; the spy exists so a case can make the
 * rule answer something the real comparison never would, and so a case can see
 * that a caller asked it at all.
 */
const rule = vi.hoisted(() => ({
  real: undefined as unknown as (amount: number, balance: number) => boolean,
  spy: vi.fn(),
}));

vi.mock('@/lib/payout-balance-rule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payout-balance-rule')>();
  rule.real = actual.exceedsPayoutBalance;
  return { ...actual, exceedsPayoutBalance: rule.spy };
});

import { CampaignPayoutPanel } from '@/components/campaign/CampaignPayoutPanel';
import { requestPayout, approvePayout, InsufficientBalanceError } from '@/lib/money/payouts';

const BALANCE = 800_000;
const FUNDRAISER = 'fundraiser-1';
const ADMIN = 'admin-1';

/**
 * The provider reading approvePayout insists on before it will decide anything
 * (FFI-07; see src/lib/money/payouts.ts). It is recorded, and it is ample --
 * above every amount either case asks about -- so the gate is passed and can
 * never be the thing that decides an outcome here. What these cases measure is
 * the CAP, so a provider figure loose enough to refuse a Payout the Campaign
 * Balance could pay would only be testing the wrong rule.
 */
const PROVIDER_READING = { provider: 'mock', providerBalance: 10_000_000 };

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

const mockFetch = vi.fn();
global.fetch = mockFetch;

function panelRead(balance: number) {
  return {
    isDemo: false,
    lifecycleStatus: 'ACTIVE' as const,
    escrowHold: 0,
    campaignBalance: balance,
    payouts: [],
    bankAccounts: [{ id: 'bank-1', bankCode: 'BCA', accountName: 'Fundraiser One' }],
  };
}

/**
 * A transaction client over one Campaign's CAMPAIGN_BALANCE account, holding
 * exactly `balance`. `ledgerEntry.groupBy` is simulated rather than mocked away
 * so `campaignBalance` sums real rows and the balance the money layer judges is
 * the figure under test, not a number handed to it -- the same simulation, and
 * for the same reason, as src/lib/money/payouts.test.ts and
 * src/lib/money/ledger.test.ts.
 */
function makeMoney(balance: number, payoutAmount: number) {
  const rows: LedgerRow[] = [
    {
      transactionId: 'gift-1',
      direction: 'CREDIT',
      amount: balance,
      account: 'CAMPAIGN_BALANCE',
      campaignId: 'campaign-1',
      volunteerTripId: null,
    },
  ];
  const payoutRow = {
    id: 'payout-1',
    campaignId: 'campaign-1',
    volunteerTripId: null,
    amount: payoutAmount,
    status: 'DRAFT',
    requestedById: FUNDRAISER,
    bankAccountId: 'bank-1',
    bankAccount: {
      id: 'bank-1',
      ownerId: FUNDRAISER,
      verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  };

  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 'campaign-1' }]),
    campaign: {
      findUnique: vi.fn(async () => ({
        creatorId: FUNDRAISER,
        isDemo: false,
        lifecycleStatus: 'ACTIVE',
        deadline: null,
        kind: 'DONATION',
        collectingEntityId: null,
      })),
    },
    bankAccount: {
      findUnique: vi.fn(async () => payoutRow.bankAccount),
    },
    payout: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'payout-new',
        createdAt: new Date(),
        ...data,
      })),
      findUnique: vi.fn(async () => payoutRow),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    ledgerEntry: {
      count: vi.fn(async () => 0),
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        rows.push(...data);
        return { count: data.length };
      }),
      groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
        const filtered = rows.filter((row) =>
          Object.entries(args.where ?? {}).every(
            ([key, value]) => (row as never as Record<string, unknown>)[key] === value,
          ),
        );
        const buckets = new Map<string, { row: Record<string, unknown>; sum: number }>();
        for (const row of filtered) {
          const key = args.by.map((k) => String((row as never as Record<string, unknown>)[k])).join('|');
          const bucket = buckets.get(key) ?? {
            row: Object.fromEntries(args.by.map((k) => [k, (row as never as Record<string, unknown>)[k]])),
            sum: 0,
          };
          bucket.sum += row.amount;
          buckets.set(key, bucket);
        }
        return Array.from(buckets.values()).map((b) => ({ ...b.row, _sum: { amount: b.sum } }));
      }),
    },
  };

  return {
    tx: tx as never,
    prisma: {
      $transaction: vi.fn((cb: (client: unknown) => unknown) => cb(tx)),
      payout: { findUniqueOrThrow: vi.fn(async () => payoutRow) },
    } as never,
  };
}

/** Asks the screen about `amount` against `balance`, and reports what it said. */
async function panelSaysOverBalance(amount: number, balance: number): Promise<boolean> {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(panelRead(balance)),
  });

  render(<CampaignPayoutPanel slug="sumur-desa" />);
  fireEvent.change(await screen.findByLabelText('Rekening tujuan'), { target: { value: 'bank-1' } });
  fireEvent.change(screen.getByLabelText(/Jumlah pencairan/), { target: { value: String(amount) } });
  fireEvent.change(screen.getByLabelText(/Keterangan/), { target: { value: 'Bahan bangunan' } });

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Ajukan pencairan/ })).toBeInTheDocument(),
  );
  const over = screen.queryByText('Jumlah melebihi Campaign Balance yang tersedia.') !== null;
  cleanup();
  return over;
}

describe('the Payout cap, asked of one rule', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    rule.spy.mockReset();
    rule.spy.mockImplementation(rule.real);
  });

  afterEach(() => {
    cleanup();
    mockFetch.mockReset();
  });

  it('is asked, not re-decided, by the money layer and by the screen alike', async () => {
    // The rule is made to answer "over the balance" for an amount of 1 rupiah
    // against 800.000. Every caller below has that amount well inside the
    // balance, so any of them that computed the answer for itself would carry
    // on as if nothing were over and this case would say so by failing.
    rule.spy.mockReturnValue(true);
    const TRIVIAL = 1;

    const request = makeMoney(BALANCE, TRIVIAL);
    await expect(
      requestPayout(request.tx, {
        subject: { type: 'campaign', campaignId: 'campaign-1' },
        requestedById: FUNDRAISER,
        bankAccountId: 'bank-1',
        amount: TRIVIAL,
        description: 'Bahan bangunan',
      }),
    ).rejects.toThrow(InsufficientBalanceError);

    // The Admin path, and the one that spends the balance: it re-reads the
    // balance under the subject's row lock, so it is the last word on the cap
    // and the least entitled to hold a second opinion about it.
    const approval = makeMoney(BALANCE, TRIVIAL);
    await expect(
      approvePayout(approval.prisma, { payoutId: 'payout-1', approvedById: ADMIN, ...PROVIDER_READING }),
    ).rejects.toThrow(InsufficientBalanceError);

    expect(await panelSaysOverBalance(TRIVIAL, BALANCE)).toBe(true);
  });

  it('gives the money layer and the screen the same answer, boundary rupiah included', async () => {
    // The amounts a disagreement shows up on: a part of the balance, the last
    // rupiah of it, exactly all of it (allowed -- CONTEXT.md asks for "sebagian
    // Campaign Balance" and the whole of it is still part of it), and the
    // first rupiah past it.
    const AMOUNTS = [1, 400_000, BALANCE - 1, BALANCE, BALANCE + 1, 9_000_000];

    for (const amount of AMOUNTS) {
      const over = rule.real(amount, BALANCE);
      // "Not the refusal" is not the same as "it worked", so each outcome is
      // named exactly: the allowance has to be an approval, not some other
      // error that happens not to be this one.
      const allowed = 'allowed';
      const refused = (err: unknown) => (err instanceof InsufficientBalanceError ? 'refused' : err);

      expect(await panelSaysOverBalance(amount, BALANCE), `the screen, ${amount} against ${BALANCE}`)
        .toBe(over);

      const request = makeMoney(BALANCE, amount);
      const requestOutcome = await requestPayout(request.tx, {
        subject: { type: 'campaign', campaignId: 'campaign-1' },
        requestedById: FUNDRAISER,
        bankAccountId: 'bank-1',
        amount,
        description: 'Bahan bangunan',
      }).then(() => allowed, refused);
      expect(requestOutcome, `requestPayout, ${amount}`).toBe(over ? 'refused' : allowed);

      const approval = makeMoney(BALANCE, amount);
      const approvalOutcome = await approvePayout(approval.prisma, {
        payoutId: 'payout-1',
        approvedById: ADMIN,
        ...PROVIDER_READING,
      }).then(() => allowed, refused);
      expect(approvalOutcome, `approvePayout, ${amount}`).toBe(over ? 'refused' : allowed);
    }
  });
});
