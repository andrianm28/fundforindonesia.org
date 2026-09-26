import { describe, it, expect, vi } from 'vitest';
import {
  requestPayout,
  approvePayout,
  DemoCampaignError,
  BankAccountNotEligibleError,
  InsufficientBalanceError,
  SelfApprovalError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
} from './payouts';
import { InvalidPayoutSubjectError } from './payout-subject';
import { PayoutNotAllowedForStatusError } from '@/lib/subject-guard';

const PAST = new Date('2020-01-01');

/**
 * Every Campaign effective status and whether a Payout may be requested or
 * approved in it (CONTEXT.md, Payout). EXPIRED appears twice: recorded, and
 * an ACTIVE Campaign whose deadline has passed, which is Expired whether or
 * not anyone has recorded it yet.
 */
const PAYOUT_BY_EFFECTIVE_STATUS: Array<{ label: string; lifecycleStatus: string; deadline: Date | null; allowed: boolean }> = [
  { label: 'ACTIVE', lifecycleStatus: 'ACTIVE', deadline: null, allowed: true },
  { label: 'EXPIRED (recorded)', lifecycleStatus: 'EXPIRED', deadline: PAST, allowed: true },
  { label: 'EXPIRED (ACTIVE past its deadline)', lifecycleStatus: 'ACTIVE', deadline: PAST, allowed: true },
  { label: 'COMPLETED', lifecycleStatus: 'COMPLETED', deadline: null, allowed: true },
  { label: 'SUSPENDED', lifecycleStatus: 'SUSPENDED', deadline: null, allowed: false },
  { label: 'CANCELLED', lifecycleStatus: 'CANCELLED', deadline: null, allowed: false },
  { label: 'DRAFT', lifecycleStatus: 'DRAFT', deadline: null, allowed: false },
  { label: 'SUBMITTED', lifecycleStatus: 'SUBMITTED', deadline: null, allowed: false },
  { label: 'REJECTED', lifecycleStatus: 'REJECTED', deadline: null, allowed: false },
];

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
};

function verifiedBankAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bank-1',
    ownerId: 'requester-1',
    bankCode: 'BCA',
    accountNumber: '1234567890',
    accountName: 'Requester One',
    verifiedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * Minimal in-memory stand-in for a Prisma transaction client, reusing the
 * same ledgerEntry.groupBy/createMany simulation as
 * src/app/api/campaigns/[slug]/payouts/route.test.ts, so
 * campaignBalance/tripBalance and postTransaction are exercised for real
 * rather than mocked away.
 */
function makeTx(
  options: {
    ledgerRows?: LedgerRow[];
    bankAccount?: Record<string, unknown> | null;
    isDemo?: boolean;
    /** The Campaign's stored status and deadline, which the subject guard turns into its effective status. */
    lifecycleStatus?: string;
    deadline?: Date | null;
    payoutRow?: Record<string, unknown> | null;
  } = {},
) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const bankAccountFindUnique = vi.fn().mockResolvedValue(options.bankAccount ?? null);
  const payoutCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'payout-1',
    createdAt: new Date(),
    ...data,
  }));
  const state = options.payoutRow ? { ...options.payoutRow } : null;
  const payoutFindUnique = vi.fn().mockResolvedValue(state);
  const payoutUpdateMany = vi.fn(
    async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
      if (!state || state.status !== where.status) return { count: 0 };
      Object.assign(state, data);
      return { count: 1 };
    },
  );
  const queryRawCalls: string[] = [];

  return {
    tx: {
      // The Campaign row the subject guard reads under its lock.
      campaign: {
        findUnique: vi.fn().mockResolvedValue({
          creatorId: 'requester-1',
          isDemo: options.isDemo ?? false,
          lifecycleStatus: options.lifecycleStatus ?? 'ACTIVE',
          deadline: options.deadline ?? null,
        }),
      },
      // The Trip row the subject guard reads under its lock.
      volunteerTrip: { findUnique: vi.fn().mockResolvedValue({ fundraiserId: 'requester-1', status: 'ACTIVE' }) },
      bankAccount: { findUnique: bankAccountFindUnique },
      payout: { create: payoutCreate, findUnique: payoutFindUnique, updateMany: payoutUpdateMany },
      $queryRaw: vi.fn((strings: TemplateStringsArray) => {
        queryRawCalls.push(strings.join(''));
        return Promise.resolve([{ id: 'locked' }]);
      }),
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
    rows,
    queryRawCalls,
    /** The Payout row as approvePayout left it. */
    payoutState: state,
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>['tx'], finalRow: Record<string, unknown>) {
  return {
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    payout: { findUniqueOrThrow: vi.fn().mockResolvedValue(finalRow) },
  };
}

describe('requestPayout', () => {
  it('creates a DRAFT Payout with volunteerTripId set and campaignId null for a trip subject', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });

    const payout = await requestPayout(tx as never, {
      subject: { type: 'trip', tripId: 'trip-1' },
      requestedById: 'requester-1',
      bankAccountId: 'bank-1',
      amount: 500_000,
      description: 'Pencairan Trip',
    });

    expect(payout.status).toBe('DRAFT');
    expect(payoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ campaignId: null, volunteerTripId: 'trip-1', amount: 500_000 }),
      }),
    );
  });

  it('creates a DRAFT Payout with campaignId set and volunteerTripId null for a campaign subject, unchanged from before', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });

    const payout = await requestPayout(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      requestedById: 'requester-1',
      bankAccountId: 'bank-1',
      amount: 500_000,
      description: 'Pencairan dana',
    });

    expect(payout.status).toBe('DRAFT');
    expect(payoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ campaignId: 'campaign-1', volunteerTripId: null }) }),
    );
  });

  it.each(PAYOUT_BY_EFFECTIVE_STATUS)(
    'on a Campaign that is effectively $label: allowed=$allowed',
    async ({ lifecycleStatus, deadline, allowed }) => {
      const ledgerRows: LedgerRow[] = [
        { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      ];
      const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows, lifecycleStatus, deadline });

      const request = requestPayout(tx as never, {
        subject: { type: 'campaign', campaignId: 'campaign-1' },
        requestedById: 'requester-1',
        bankAccountId: 'bank-1',
        amount: 500_000,
        description: 'Pencairan dana',
      });

      if (allowed) {
        await expect(request).resolves.toMatchObject({ status: 'DRAFT' });
      } else {
        await expect(request).rejects.toMatchObject({ code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS' });
        await expect(request).rejects.toBeInstanceOf(PayoutNotAllowedForStatusError);
        expect(payoutCreate).not.toHaveBeenCalled();
      }
    },
  );

  it('rejects a demo campaign subject with DemoCampaignError, without ever looking up a bank account', async () => {
    const { tx, bankAccountFindUnique } = makeTx({ bankAccount: verifiedBankAccount(), isDemo: true });

    await expect(
      requestPayout(tx as never, {
        subject: { type: 'campaign', campaignId: 'campaign-1' },
        requestedById: 'requester-1',
        bankAccountId: 'bank-1',
        amount: 100_000,
        description: 'x',
      }),
    ).rejects.toThrow(DemoCampaignError);
    expect(bankAccountFindUnique).not.toHaveBeenCalled();
  });

  it('never runs the isDemo check for a trip subject -- VolunteerTrip has no isDemo field', async () => {
    const { tx } = makeTx({ bankAccount: verifiedBankAccount() });

    await requestPayout(tx as never, {
      subject: { type: 'trip', tripId: 'trip-1' },
      requestedById: 'requester-1',
      bankAccountId: 'bank-1',
      amount: 0,
      description: 'x',
    });

    expect(tx.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unverified bank account for a trip subject exactly as it already does for a campaign subject', async () => {
    const { tx } = makeTx({ bankAccount: verifiedBankAccount({ verifiedAt: null }) });

    await expect(
      requestPayout(tx as never, {
        subject: { type: 'trip', tripId: 'trip-1' },
        requestedById: 'requester-1',
        bankAccountId: 'bank-1',
        amount: 0,
        description: 'x',
      }),
    ).rejects.toThrow(BankAccountNotEligibleError);
  });

  it('REGRESSION: rejects an amount over TRIP_BALANCE even when CAMPAIGN_BALANCE rows for a different subject show ample funds', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 10_000_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });

    await expect(
      requestPayout(tx as never, {
        subject: { type: 'trip', tripId: 'trip-1' },
        requestedById: 'requester-1',
        bankAccountId: 'bank-1',
        amount: 1,
        description: 'x',
      }),
    ).rejects.toThrow(InsufficientBalanceError);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('REGRESSION: rejects an amount over CAMPAIGN_BALANCE even when TRIP_BALANCE rows for a different subject show ample funds', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 10_000_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });

    await expect(
      requestPayout(tx as never, {
        subject: { type: 'campaign', campaignId: 'campaign-1' },
        requestedById: 'requester-1',
        bankAccountId: 'bank-1',
        amount: 1,
        description: 'x',
      }),
    ).rejects.toThrow(InsufficientBalanceError);
    expect(payoutCreate).not.toHaveBeenCalled();
  });
});

describe('approvePayout', () => {
  const basePayoutRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'payout-1',
    campaignId: null,
    volunteerTripId: 'trip-1',
    amount: 500_000,
    status: 'DRAFT',
    requestedById: 'requester-1',
    approvedById: null,
    bankAccount: verifiedBankAccount(),
    ...overrides,
  });

  it.each(PAYOUT_BY_EFFECTIVE_STATUS)(
    'on a Campaign that is effectively $label: allowed=$allowed',
    async ({ lifecycleStatus, deadline, allowed }) => {
      const payoutRow = basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: null });
      const ledgerRows: LedgerRow[] = [
        { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      ];
      const { tx, rows, payoutState } = makeTx({ ledgerRows, payoutRow, lifecycleStatus, deadline });
      const prisma = makePrisma(tx, { ...payoutRow, status: 'APPROVED', approvedById: 'admin-1' });

      const approval = approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' });

      if (allowed) {
        await expect(approval).resolves.toMatchObject({ status: 'APPROVED' });
      } else {
        await expect(approval).rejects.toMatchObject({ code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS' });
        expect(payoutState).toMatchObject({ status: 'DRAFT', approvedById: null });
        expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
      }
    },
  );

  it('refuses approval when a Suspension was committed after the request and before the approval took its lock, leaving the Payout as it was', async () => {
    const payoutRow = basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: null });
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx, rows, payoutState } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows, payoutRow });

    // Requested while the Campaign is Active.
    await requestPayout(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      requestedById: 'requester-1',
      bankAccountId: 'bank-1',
      amount: 500_000,
      description: 'Pencairan dana',
    });

    // The Suspension commits; the next read of the Campaign row sees it.
    tx.campaign.findUnique.mockResolvedValue({
      creatorId: 'requester-1',
      isDemo: false,
      lifecycleStatus: 'SUSPENDED',
      deadline: null,
    });
    const prisma = makePrisma(tx, payoutRow);

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' }),
    ).rejects.toMatchObject({ code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS' });
    expect(payoutState).toMatchObject({ status: 'DRAFT', approvedById: null });
    expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
  });

  it.each([
    ['Campaign', { campaignId: 'campaign-1', volunteerTripId: null }, 'OWN_CAMPAIGN_CONFLICT', 'CAMPAIGN_BALANCE'],
    ['Volunteer Trip', { campaignId: null, volunteerTripId: 'trip-1' }, 'OWN_TRIP_CONFLICT', 'TRIP_BALANCE'],
  ] as const)(
    'refuses an Admin who owns the %s, though someone else requested it, leaving the Payout as it was',
    async (_label, link, code, account) => {
      // The owner read under the lock is the approving Admin; the request
      // came from someone else, so the two-person rule alone would pass it.
      const payoutRow = basePayoutRow({ ...link, requestedById: 'requester-1' });
      const ledgerRows: LedgerRow[] = [
        { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account, campaignId: link.campaignId, volunteerTripId: link.volunteerTripId },
      ];
      const { tx, rows, payoutState, queryRawCalls } = makeTx({ ledgerRows, payoutRow });
      tx.campaign.findUnique.mockResolvedValue({ creatorId: 'admin-1', isDemo: false, lifecycleStatus: 'ACTIVE', deadline: null });
      tx.volunteerTrip.findUnique.mockResolvedValue({ fundraiserId: 'admin-1', status: 'ACTIVE' });
      const prisma = makePrisma(tx, payoutRow);

      await expect(
        approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' }),
      ).rejects.toMatchObject({ code });
      expect(queryRawCalls.some((q) => q.includes('FOR UPDATE'))).toBe(true);
      expect(payoutState).toMatchObject({ status: 'DRAFT', approvedById: null });
      expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
    },
  );

  it('approves a Trip-linked DRAFT payout: locks VolunteerTrip (not Campaign), debits TRIP_BALANCE, credits PAYOUT_CLEARING', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const { tx, rows, queryRawCalls } = makeTx({ ledgerRows, payoutRow: basePayoutRow() });
    const prisma = makePrisma(tx, { ...basePayoutRow(), status: 'APPROVED', approvedById: 'admin-1' });

    const result = await approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' });

    expect(result.status).toBe('APPROVED');
    expect(queryRawCalls.some((q) => q.includes('VolunteerTrip'))).toBe(true);
    expect(queryRawCalls.some((q) => q.includes('"Campaign"'))).toBe(false);
    const posted = rows.filter((r) => r.transactionId === 'payout-instructed-payout-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'TRIP_BALANCE', direction: 'DEBIT', amount: 500_000, volunteerTripId: 'trip-1', campaignId: null }),
      expect.objectContaining({ account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: 500_000 }),
    ]);
  });

  it('approves a Campaign-linked DRAFT payout unchanged from prior behavior: locks Campaign (not VolunteerTrip), debits CAMPAIGN_BALANCE', async () => {
    const payoutRow = basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: null });
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx, rows, queryRawCalls } = makeTx({ ledgerRows, payoutRow });
    const prisma = makePrisma(tx, { ...payoutRow, status: 'APPROVED', approvedById: 'admin-1' });

    const result = await approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' });

    expect(result.status).toBe('APPROVED');
    expect(queryRawCalls.some((q) => q.includes('"Campaign"'))).toBe(true);
    expect(queryRawCalls.some((q) => q.includes('VolunteerTrip'))).toBe(false);
    const posted = rows.filter((r) => r.transactionId === 'payout-instructed-payout-1');
    expect(posted[0]).toMatchObject({ account: 'CAMPAIGN_BALANCE', direction: 'DEBIT', campaignId: 'campaign-1', volunteerTripId: null });
  });

  it('REGRESSION: a Trip-linked payout can never debit CAMPAIGN_BALANCE even when Campaign has ample funds', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 10_000_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      { transactionId: 't2', direction: 'CREDIT', amount: 500_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const { tx, rows } = makeTx({ ledgerRows, payoutRow: basePayoutRow({ amount: 500_000 }) });
    const prisma = makePrisma(tx, { ...basePayoutRow({ amount: 500_000 }), status: 'APPROVED' });

    await approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'payout-instructed-payout-1');
    expect(posted.every((r) => r.account !== 'CAMPAIGN_BALANCE')).toBe(true);
    expect(posted.find((r) => r.direction === 'DEBIT')).toMatchObject({ account: 'TRIP_BALANCE', volunteerTripId: 'trip-1' });
  });

  it('REGRESSION: a Campaign-linked payout can never debit TRIP_BALANCE even when the Trip has ample funds', async () => {
    const payoutRow = basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: null, amount: 500_000 });
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 10_000_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
      { transactionId: 't2', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx, rows } = makeTx({ ledgerRows, payoutRow });
    const prisma = makePrisma(tx, { ...payoutRow, status: 'APPROVED' });

    await approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' });

    const posted = rows.filter((r) => r.transactionId === 'payout-instructed-payout-1');
    expect(posted.every((r) => r.account !== 'TRIP_BALANCE')).toBe(true);
    expect(posted.find((r) => r.direction === 'DEBIT')).toMatchObject({ account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' });
  });

  it('refuses self-approval for a Trip-linked payout exactly as it already does for a Campaign-linked one', async () => {
    const { tx } = makeTx({ payoutRow: basePayoutRow({ requestedById: 'same-person' }) });
    const prisma = makePrisma(tx, basePayoutRow());

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'same-person' }),
    ).rejects.toThrow(SelfApprovalError);
  });

  it('throws PayoutNotFoundError for a nonexistent payout', async () => {
    const { tx } = makeTx({ payoutRow: null });
    const prisma = makePrisma(tx, {});

    await expect(
      approvePayout(prisma as never, { payoutId: 'missing', approvedById: 'admin-1' }),
    ).rejects.toThrow(PayoutNotFoundError);
  });

  it('throws InvalidPayoutStatusError for a Trip-linked payout that is not DRAFT', async () => {
    const { tx } = makeTx({ payoutRow: basePayoutRow({ status: 'APPROVED' }) });
    const prisma = makePrisma(tx, basePayoutRow({ status: 'APPROVED' }));

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' }),
    ).rejects.toThrow(InvalidPayoutStatusError);
  });

  it('refuses approval when the bank account is no longer eligible for a Trip-linked payout, re-checked at approval time', async () => {
    const { tx } = makeTx({ payoutRow: basePayoutRow({ bankAccount: { ...verifiedBankAccount(), verifiedAt: null } }) });
    const prisma = makePrisma(tx, basePayoutRow());

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' }),
    ).rejects.toThrow(BankAccountNotEligibleError);
  });

  it('rejects a Trip-linked payout when TRIP_BALANCE no longer covers it, re-checked after the lock', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 100_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const { tx } = makeTx({ ledgerRows, payoutRow: basePayoutRow({ amount: 500_000 }) });
    const prisma = makePrisma(tx, basePayoutRow({ amount: 500_000 }));

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' }),
    ).rejects.toThrow(InsufficientBalanceError);
  });

  it('throws for a malformed Payout row with both campaignId and volunteerTripId set (or neither) -- defends against a future writer that bypasses requestPayout\'s own guard', async () => {
    const { tx } = makeTx({ payoutRow: basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: 'trip-1' }) });
    const prisma = makePrisma(tx, basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: 'trip-1' }));

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1' }),
    ).rejects.toThrow(InvalidPayoutSubjectError);
  });
});
