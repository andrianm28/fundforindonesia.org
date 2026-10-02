import { describe, it, expect, vi } from 'vitest';
import {
  requestPayout,
  approvePayout,
  completePayout,
  recordPayoutBalanceShort,
  DemoCampaignError,
  BankAccountNotEligibleError,
  InsufficientBalanceError,
  SelfApprovalError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
  ProviderBalanceNotRecordedError,
  ProviderBalanceAmountError,
  ProviderBalanceNotShortError,
  UnknownPaymentProviderNameError,
} from './payouts';
import { InvalidPayoutSubjectError } from './payout-subject';
import { PayoutNotAllowedForStatusError } from '@/lib/subject-guard';
import { OwnSubjectConflictError } from '@/lib/capacity';
import { UsageReportRequiredError } from '@/lib/usage-report-errors';
import {
  validateProofReference,
  validateProofNote,
  buildProofImage,
  MAX_PROOF_REFERENCE_LENGTH,
  MAX_PROOF_NOTE_LENGTH,
} from '@/lib/payout-proof';
import { ledgerGroupBy } from '../../../tests/support/ledger-group-by';

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
  programId?: string | null;
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
 * Minimal in-memory stand-in for a Prisma transaction client, using the shared
 * ledgerEntry.groupBy/createMany simulation
 * (tests/support/ledger-group-by.ts), so campaignBalance/tripBalance and
 * postTransaction are exercised for real rather than mocked away.
 */
function makeTx(
  options: {
    ledgerRows?: LedgerRow[];
    bankAccount?: Record<string, unknown> | null;
    isDemo?: boolean;
    /** The Campaign's stored status and deadline, which the subject guard turns into its effective status. */
    lifecycleStatus?: string;
    deadline?: Date | null;
    /** The Volunteer Trip's stored status (ticket 38); ACTIVE unless a test says otherwise. */
    tripStatus?: string;
    payoutRow?: Record<string, unknown> | null;
    /**
     * The row `campaignBlockingUsageReport` (@/lib/usage-reports.ts) should
     * find via `tx.payout.findFirst` -- a prior COMPLETED Payout on this
     * Campaign with no Usage Report, or a disputed one. Null (the default)
     * means nothing blocks, unchanged from before this gate existed.
     */
    blockingPayout?: Record<string, unknown> | null;
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
  const payoutFindFirst = vi.fn().mockResolvedValue(options.blockingPayout ?? null);
  const payoutUpdateMany = vi.fn(
    async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
      if (!state || state.status !== where.status) return { count: 0 };
      Object.assign(state, data);
      return { count: 1 };
    },
  );
  const queryRawCalls: string[] = [];
  const payoutBalanceChecks: Array<Record<string, unknown>> = [];
  const payoutBalanceCheckCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `check-${payoutBalanceChecks.length + 1}`, checkedAt: new Date(), ...data };
    payoutBalanceChecks.push(row);
    return row;
  });

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
      volunteerTrip: {
        findUnique: vi.fn().mockResolvedValue({ fundraiserId: 'requester-1', status: options.tripStatus ?? 'ACTIVE' }),
      },
      bankAccount: { findUnique: bankAccountFindUnique },
      payout: { create: payoutCreate, findUnique: payoutFindUnique, findFirst: payoutFindFirst, updateMany: payoutUpdateMany },
      payoutBalanceCheck: { create: payoutBalanceCheckCreate },
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
        groupBy: vi.fn(ledgerGroupBy(rows)),
      },
    },
    bankAccountFindUnique,
    payoutCreate,
    payoutFindFirst,
    payoutBalanceCheckCreate,
    payoutBalanceChecks,
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

  it('refuses a new Campaign Payout when a prior COMPLETED Payout on it has no Usage Report (or a disputed one)', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx, payoutCreate, payoutFindFirst } = makeTx({
      bankAccount: verifiedBankAccount(),
      ledgerRows,
      blockingPayout: { id: 'payout-old', campaignId: 'campaign-1', status: 'COMPLETED' },
    });

    const request = requestPayout(tx as never, {
      subject: { type: 'campaign', campaignId: 'campaign-1' },
      requestedById: 'requester-1',
      bankAccountId: 'bank-1',
      amount: 100_000,
      description: 'x',
    });

    await expect(request).rejects.toBeInstanceOf(UsageReportRequiredError);
    await expect(request).rejects.toMatchObject({ code: 'USAGE_REPORT_REQUIRED' });
    expect(payoutCreate).not.toHaveBeenCalled();
    expect(payoutFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ campaignId: 'campaign-1', status: 'COMPLETED' }) }),
    );
  });

  it('allows a new Campaign Payout when no prior COMPLETED Payout is missing an undisputed Usage Report', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows, blockingPayout: null });

    await expect(
      requestPayout(tx as never, {
        subject: { type: 'campaign', campaignId: 'campaign-1' },
        requestedById: 'requester-1',
        bankAccountId: 'bank-1',
        amount: 100_000,
        description: 'x',
      }),
    ).resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('never runs the Usage Report gate for a Trip subject -- the requirement is Campaign-only (CONTEXT.md, Usage Report)', async () => {
    const { tx, payoutFindFirst } = makeTx({ bankAccount: verifiedBankAccount() });

    await requestPayout(tx as never, {
      subject: { type: 'trip', tripId: 'trip-1' },
      requestedById: 'requester-1',
      bankAccountId: 'bank-1',
      amount: 0,
      description: 'x',
    });

    expect(payoutFindFirst).not.toHaveBeenCalled();
  });
});

/**
 * csr-and-hibah 07: a Program Balance can never be the source of a Payout.
 * LedgerSubject has no Program variant, so the type already refuses one; this
 * is the same refusal at runtime, for a caller that got a Program-shaped
 * subject past the compiler (a JSON body, a cast). The subject is built
 * through `unknown` rather than `any`, which is exactly what such a caller
 * would do.
 */
describe('requestPayout against a Program', () => {
  const programSubject = { type: 'program', programId: 'prog-1' } as unknown as Parameters<
    typeof requestPayout
  >[1]['subject'];
  const programMoney: LedgerRow[] = [
    { transactionId: 'mc-1', direction: 'CREDIT', amount: 500_000, account: 'PROGRAM_BALANCE', campaignId: null, volunteerTripId: null, programId: 'prog-1' },
  ];

  it('refuses a Program subject and creates no Payout, though the Program holds money and the bank account is verified', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows: programMoney });

    await expect(
      requestPayout(tx as never, {
        subject: programSubject,
        requestedById: 'requester-1',
        bankAccountId: 'bank-1',
        amount: 500_000,
        description: 'Pencairan Program',
      }),
    ).rejects.toThrow(InvalidPayoutSubjectError);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('refuses before taking any lock or reading any balance', async () => {
    const { tx, queryRawCalls } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows: programMoney });

    await expect(
      requestPayout(tx as never, {
        subject: programSubject,
        requestedById: 'requester-1',
        bankAccountId: 'bank-1',
        amount: 1,
        description: 'Pencairan Program',
      }),
    ).rejects.toThrow(InvalidPayoutSubjectError);
    expect(queryRawCalls).toEqual([]);
    expect(tx.ledgerEntry.groupBy).not.toHaveBeenCalled();
  });
});

describe('completePayout', () => {
  /**
   * A Payout as it stands at the point a second Admin records the transfer:
   * already APPROVED by one Admin, its instructed legs posted, the money
   * debited from the Campaign's balance and sitting in PAYOUT_CLEARING.
   */
  const approvedPayoutRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'payout-1',
    campaignId: 'campaign-1',
    volunteerTripId: null,
    amount: 500_000,
    status: 'APPROVED',
    requestedById: 'requester-1',
    approvedById: 'admin-1',
    approvedAt: new Date('2026-02-01'),
    proofImage: null,
    completedById: null,
    completedAt: null,
    // The destination, as completePayout now reads it: the same re-check
    // approvePayout makes, in the same include, so the same three gaps --
    // missing, not the requester's, no verifiedAt -- refuse here too.
    bankAccount: verifiedBankAccount(),
    ...overrides,
  });

  const INSTRUCTED_ROWS: LedgerRow[] = [
    // The instruction already posted at approval: the Campaign's balance is
    // already short and PAYOUT_CLEARING is already holding the money.
    { transactionId: 'payout-instructed-payout-1', direction: 'DEBIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    { transactionId: 'payout-instructed-payout-1', direction: 'CREDIT', amount: 500_000, account: 'PAYOUT_CLEARING', campaignId: null, volunteerTripId: null },
  ];

  it('marks an APPROVED payout COMPLETED with the proof attached, and posts DEBIT PAYOUT_CLEARING / CREDIT GATEWAY_CLEARING', async () => {
    const { tx, rows, payoutState } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, { ...approvedPayoutRow(), status: 'COMPLETED', completedById: 'admin-2' });

    const result = await completePayout(prisma as never, {
      payoutId: 'payout-1',
      completedById: 'admin-2',
      proofReference: 'TRX-admin-2',
      proofNote: 'Ditransfer via mobile banking BCA, dicocokkan dengan nominal dan rekening tujuan.',
    });

    expect(result.status).toBe('COMPLETED');
    expect(payoutState).toMatchObject({
      status: 'COMPLETED',
      completedById: 'admin-2',
      completedAt: expect.any(Date),
      proofImage: buildProofImage(
        'TRX-admin-2',
        'Ditransfer via mobile banking BCA, dicocokkan dengan nominal dan rekening tujuan.',
      ),
    });

    const posted = rows.filter((r) => r.transactionId === 'payout-completed-payout-1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'PAYOUT_CLEARING', direction: 'DEBIT', amount: 500_000, campaignId: null, volunteerTripId: null }),
      expect.objectContaining({ account: 'GATEWAY_CLEARING', direction: 'CREDIT', amount: 500_000, campaignId: null, volunteerTripId: null }),
    ]);
  });

  it('drains PAYOUT_CLEARING exactly: the account is back to zero once the transfer is recorded', async () => {
    const { tx, rows } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, { ...approvedPayoutRow(), status: 'COMPLETED' });

    await completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' });

    const clearing = rows
      .filter((r) => r.account === 'PAYOUT_CLEARING')
      .reduce((sum, r) => (r.direction === 'CREDIT' ? sum + r.amount : sum - r.amount), 0);
    expect(clearing).toBe(0);
  });

  it('refuses a Payout whose Bank Account lost its verification after approval, with the same error and message the other two gates raise', async () => {
    // Verification can be revoked (by hand, outside the app) for an account
    // that turns out to be fraudulent, and that window does not close at
    // approval: the money has not been sent until the second Admin records
    // it here. Recording the transfer anyway would make this the one money-out
    // step that never asks whether the destination is still eligible.
    const { tx, rows, payoutState, queryRawCalls } = makeTx({
      ledgerRows: INSTRUCTED_ROWS,
      payoutRow: approvedPayoutRow({ bankAccount: verifiedBankAccount({ verifiedAt: null }) }),
    });
    const prisma = makePrisma(tx, {});

    const refusal = await completePayout(prisma as never, {
      payoutId: 'payout-1',
      completedById: 'admin-2',
      proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA',
    }).then(
      () => null,
      (error: BankAccountNotEligibleError) => error,
    );

    // The one error the other two gates raise, unchanged -- no third rule
    // and no new code for the same judgement.
    expect(refusal).toBeInstanceOf(BankAccountNotEligibleError);
    expect(refusal).toMatchObject({ code: 'BANK_ACCOUNT_NOT_ELIGIBLE', message: new BankAccountNotEligibleError().message });
    // Refused on the Payout's own row, like the two gates before it: nothing
    // is locked, nothing is written, and the money stays in PAYOUT_CLEARING
    // for an Admin who can still act on it.
    expect(queryRawCalls).toEqual([]);
    expect(payoutState).toMatchObject({ status: 'APPROVED', completedById: null, proofImage: null });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it.each([
    ['the Bank Account is gone', null],
    ['it is not the requester\'s any more', verifiedBankAccount({ ownerId: 'a-stranger' })],
  ])('refuses completion for the same reason when $label, like the gate at approval', async (_label, bankAccount) => {
    const { tx, rows, payoutState } = makeTx({
      ledgerRows: INSTRUCTED_ROWS,
      payoutRow: approvedPayoutRow({ bankAccount }),
    });
    const prisma = makePrisma(tx, {});

    await expect(
      completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' }),
    ).rejects.toThrow(BankAccountNotEligibleError);
    expect(payoutState).toMatchObject({ status: 'APPROVED', completedById: null });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it('completes a Payout whose Bank Account is still verified and still the requester\'s: the new gate refuses only what approval would have refused', async () => {
    // The other half of the guarantee. A gate that refuses every completion
    // would pass the test above and break the money-out path it exists to
    // protect, so the ordinary case is asserted, not assumed.
    const { tx, rows, payoutState } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, { ...approvedPayoutRow(), status: 'COMPLETED' });

    const result = await completePayout(prisma as never, {
      payoutId: 'payout-1',
      completedById: 'admin-2',
      proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA',
    });

    expect(result.status).toBe('COMPLETED');
    expect(payoutState).toMatchObject({ status: 'COMPLETED', completedById: 'admin-2' });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toHaveLength(2);
  });

  it('refuses to complete without a transaction reference, writing nothing at all', async () => {
    // Ticket 13's answer: a reference and a note, not one typed character.
    // Blank or whitespace-only fails the same rule the Admin's own form
    // asks through @/lib/payout-proof's validateProofReference -- checked
    // here against that exact function, so this test would fail if
    // completePayout ever kept a copy of its own instead of importing it.
    const { tx, rows, payoutState, queryRawCalls } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, {});

    for (const proofReference of ['', '   ']) {
      await expect(
        completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference, proofNote: 'Ditransfer via BCA' }),
      ).rejects.toMatchObject({ code: 'PAYOUT_PROOF_INVALID', message: validateProofReference(proofReference)! });
    }
    expect(payoutState).toMatchObject({ status: 'APPROVED', completedById: null, proofImage: null });
    expect(queryRawCalls).toEqual([]);
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it('refuses to complete without a note, writing nothing at all', async () => {
    // The other half of the same rule: a reference alone is not proof
    // either (FFI-07 asks for a note, not just a reference).
    const { tx, rows, payoutState, queryRawCalls } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, {});

    for (const proofNote of ['', '   ']) {
      await expect(
        completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote }),
      ).rejects.toMatchObject({ code: 'PAYOUT_PROOF_INVALID', message: validateProofNote(proofNote)! });
    }
    expect(payoutState).toMatchObject({ status: 'APPROVED', completedById: null, proofImage: null });
    expect(queryRawCalls).toEqual([]);
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it('refuses a reference or note over the length limit, the same limits @/lib/payout-proof enforces', async () => {
    const { tx, rows, payoutState } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, {});

    const tooLongReference = 'a'.repeat(MAX_PROOF_REFERENCE_LENGTH + 1);
    await expect(
      completePayout(prisma as never, {
        payoutId: 'payout-1',
        completedById: 'admin-2',
        proofReference: tooLongReference,
        proofNote: 'Ditransfer via BCA',
      }),
    ).rejects.toMatchObject({ code: 'PAYOUT_PROOF_INVALID', message: validateProofReference(tooLongReference)! });

    const tooLongNote = 'a'.repeat(MAX_PROOF_NOTE_LENGTH + 1);
    await expect(
      completePayout(prisma as never, {
        payoutId: 'payout-1',
        completedById: 'admin-2',
        proofReference: 'TRX-1',
        proofNote: tooLongNote,
      }),
    ).rejects.toMatchObject({ code: 'PAYOUT_PROOF_INVALID', message: validateProofNote(tooLongNote)! });

    expect(payoutState).toMatchObject({ status: 'APPROVED', completedById: null, proofImage: null });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it('accepts a valid reference and note, storing them joined by buildProofImage -- the same function the form uses', async () => {
    const { tx, payoutState } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, { ...approvedPayoutRow(), status: 'COMPLETED' });

    const result = await completePayout(prisma as never, {
      payoutId: 'payout-1',
      completedById: 'admin-2',
      proofReference: 'TRX-1',
      proofNote: 'Ditransfer via BCA',
    });

    expect(result.status).toBe('COMPLETED');
    expect(payoutState).toMatchObject({ proofImage: buildProofImage('TRX-1', 'Ditransfer via BCA') });
  });

  it('refuses the Admin who approved it -- the second half of the two-person rule, and it leaves the Payout APPROVED', async () => {
    const { tx, rows, payoutState } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, {});

    await expect(
      completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-1', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' }),
    ).rejects.toMatchObject({ code: 'TWO_PERSON_RULE' });
    expect(payoutState).toMatchObject({ status: 'APPROVED', proofImage: null });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it('refuses a Payout nobody approved, whatever the completer: an APPROVED row with no recorded approver cannot show two people', async () => {
    const { tx, payoutState } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow({ approvedById: null }) });
    const prisma = makePrisma(tx, {});

    await expect(
      completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' }),
    ).rejects.toMatchObject({ code: 'TWO_PERSON_RULE' });
    expect(payoutState).toMatchObject({ status: 'APPROVED' });
  });

  it.each([
    ['Campaign', { campaignId: 'campaign-1', volunteerTripId: null }, 'OWN_CAMPAIGN_CONFLICT'],
    ['Volunteer Trip', { campaignId: null, volunteerTripId: 'trip-1' }, 'OWN_TRIP_CONFLICT'],
  ] as const)(
    'refuses an Admin who is the %s Fundraiser, even though they are not the approver',
    async (_label, link, code) => {
      // The owner is the requester, so "completer is not the approver" passes
      // here on its own: without the ownership check, the Fundraiser who
      // asked for the money could also record having sent it (CONTEXT.md,
      // Admin: never an Admin over your own subject).
      const { tx, rows, payoutState } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow({ ...link }) });
      const prisma = makePrisma(tx, {});

      await expect(
        completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'requester-1', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' }),
      ).rejects.toMatchObject({ code });
      expect(payoutState).toMatchObject({ status: 'APPROVED', proofImage: null });
      expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
    },
  );

  it.each(PAYOUT_BY_EFFECTIVE_STATUS)(
    'on a Campaign that is effectively $label: allowed=$allowed',
    async ({ lifecycleStatus, deadline, allowed }) => {
      // A Suspension landing between approval and completion still holds the
      // Payout (CONTEXT.md, Payout): the money was never instructed to the
      // bank, so completing it now would record a transfer that must not
      // happen.
      const { tx, rows, payoutState } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow(), lifecycleStatus, deadline });
      const prisma = makePrisma(tx, { ...approvedPayoutRow(), status: 'COMPLETED' });

      const completion = completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' });

      if (allowed) {
        await expect(completion).resolves.toMatchObject({ status: 'COMPLETED' });
        expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toHaveLength(2);
      } else {
        await expect(completion).rejects.toMatchObject({ code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS' });
        expect(payoutState).toMatchObject({ status: 'APPROVED', proofImage: null });
        expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
      }
    },
  );

  it('takes the same Campaign row lock the Cancellation approval takes, before its status write', async () => {
    // Cancellation approval refuses while no Payout is COMPLETED, under the
    // Campaign row lock (campaign-lifecycle.ts). Both sides must lock the
    // same row, or a Payout could complete between that check and the
    // Cancellation's write and break the rule that a Cancellation happens
    // only while no Payout has completed.
    const { tx, queryRawCalls } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    const prisma = makePrisma(tx, { ...approvedPayoutRow(), status: 'COMPLETED' });

    await completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' });

    const lockIndex = queryRawCalls.findIndex((q) => q.includes('FOR UPDATE'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(queryRawCalls[lockIndex]).toContain('"Campaign"');
    // The lock comes before the write, not after it.
    expect(tx.payout.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
  });

  it('locks VolunteerTrip, never Campaign, for a Trip-linked payout', async () => {
    const { tx, queryRawCalls } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow({ campaignId: null, volunteerTripId: 'trip-1' }) });
    const prisma = makePrisma(tx, { ...approvedPayoutRow(), status: 'COMPLETED' });

    await completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' });

    expect(queryRawCalls.some((q) => q.includes('VolunteerTrip'))).toBe(true);
    expect(queryRawCalls.some((q) => q.includes('"Campaign"'))).toBe(false);
  });

  it('refuses to complete a Payout that is not APPROVED, and never posts the completion legs', async () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED']) {
      const { tx, rows, queryRawCalls } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow({ status }) });
      const prisma = makePrisma(tx, {});

      await expect(
        completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' }),
      ).rejects.toMatchObject({ code: 'INVALID_PAYOUT_STATUS' });
      // Refused on the Payout's own row, before any lock: there is nothing
      // for the subject's state to decide.
      expect(queryRawCalls).toEqual([]);
      expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
    }
  });

  it('refuses when another Admin completed the same Payout first, posting nothing', async () => {
    const { tx, rows } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: approvedPayoutRow() });
    // The predicated update finds no APPROVED row left to claim.
    tx.payout.updateMany.mockResolvedValue({ count: 0 });
    const prisma = makePrisma(tx, {});

    await expect(
      completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYOUT_STATUS' });
    expect(rows.filter((r) => r.transactionId === 'payout-completed-payout-1')).toEqual([]);
  });

  it('throws PayoutNotFoundError for a Payout that does not exist', async () => {
    const { tx } = makeTx({ ledgerRows: INSTRUCTED_ROWS, payoutRow: null });
    const prisma = makePrisma(tx, {});

    await expect(
      completePayout(prisma as never, { payoutId: 'missing', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' }),
    ).rejects.toMatchObject({ code: 'PAYOUT_NOT_FOUND' });
  });

  it('throws for a malformed Payout row with both campaignId and volunteerTripId set', async () => {
    const { tx } = makeTx({
      ledgerRows: INSTRUCTED_ROWS,
      payoutRow: approvedPayoutRow({ campaignId: 'campaign-1', volunteerTripId: 'trip-1' }),
    });
    const prisma = makePrisma(tx, {});

    await expect(
      completePayout(prisma as never, { payoutId: 'payout-1', completedById: 'admin-2', proofReference: 'TRX-1', proofNote: 'Ditransfer via BCA' }),
    ).rejects.toThrow(InvalidPayoutSubjectError);
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

  /**
   * A DRAFT Payout whose Campaign is owed exactly what it asks for, and an
   * approval ready to go: the ordinary case both the reading and the name
   * below are judged against.
   */
  const fundedPayout = (overrides: Record<string, unknown> = {}) => {
    const payoutRow = basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: null, ...overrides });
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const tx = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows, payoutRow });
    // The row as it reads AFTER the transaction commits, mirroring how the
    // other approvePayout tests in this file pass their final row.
    const approved = (extra: Record<string, unknown> = {}) => ({
      ...payoutRow,
      status: 'APPROVED',
      approvedById: 'admin-1',
      approvedProvider: 'sumopod',
      approvedProviderBalance: 2_000_000,
      ...extra,
    });
    return { payoutRow, ...tx, prismaFor: (extra?: Record<string, unknown>) => makePrisma(tx.tx, approved(extra)) };
  };

  it.each(PAYOUT_BY_EFFECTIVE_STATUS)(
    'on a Campaign that is effectively $label: allowed=$allowed',
    async ({ lifecycleStatus, deadline, allowed }) => {
      const payoutRow = basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: null });
      const ledgerRows: LedgerRow[] = [
        { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
      ];
      const { tx, rows, payoutState } = makeTx({ ledgerRows, payoutRow, lifecycleStatus, deadline });
      const prisma = makePrisma(tx, { ...payoutRow, status: 'APPROVED', approvedById: 'admin-1' });

      const approval = approvePayout(prisma as never, {
        payoutId: 'payout-1',
        approvedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: 2_000_000,
      });

      if (allowed) {
        await expect(approval).resolves.toMatchObject({ status: 'APPROVED' });
      } else {
        await expect(approval).rejects.toMatchObject({ code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS' });
        expect(payoutState).toMatchObject({ status: 'DRAFT', approvedById: null });
        expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
      }
    },
  );

  describe('a Volunteer Trip Payout while the Trip is Suspended (ticket 38)', () => {
    const tripLedger: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 500_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];

    it.each(['ACTIVE', 'COMPLETED'])('approves a Trip Fee Payout on a %s Trip', async (tripStatus) => {
      const payoutRow = basePayoutRow();
      const { tx } = makeTx({ ledgerRows: tripLedger, payoutRow, tripStatus });
      const prisma = makePrisma(tx, { ...payoutRow, status: 'APPROVED', approvedById: 'admin-1' });

      await expect(
        approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 }),
      ).resolves.toMatchObject({ status: 'APPROVED' });
    });

    it('refuses to approve a Trip Fee Payout on a SUSPENDED Trip: it stays DRAFT and posts nothing', async () => {
      const payoutRow = basePayoutRow();
      const { tx, rows, payoutState } = makeTx({ ledgerRows: tripLedger, payoutRow, tripStatus: 'SUSPENDED' });
      const prisma = makePrisma(tx, { ...payoutRow, status: 'APPROVED', approvedById: 'admin-1' });

      const approval = approvePayout(prisma as never, {
        payoutId: 'payout-1',
        approvedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: 2_000_000,
      });

      await expect(approval).rejects.toMatchObject({ code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS' });
      expect(payoutState).toMatchObject({ status: 'DRAFT', approvedById: null });
      expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
    });

    it('refuses to request a Trip Fee Payout on a SUSPENDED Trip', async () => {
      const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows: tripLedger, tripStatus: 'SUSPENDED' });

      await expect(
        requestPayout(tx as never, {
          subject: { type: 'trip', tripId: 'trip-1' },
          requestedById: 'requester-1',
          bankAccountId: 'bank-1',
          amount: 500_000,
          description: 'Pencairan Trip Fee',
        }),
      ).rejects.toBeInstanceOf(PayoutNotAllowedForStatusError);
      expect(payoutCreate).not.toHaveBeenCalled();
    });
  });

  /**
   * FFI-07 story 53: "record the provider's real balance when I approve, so
   * that an approval is checked against money that actually exists."
   *
   * Sumopod has no balance API and no provider this platform talks to has one
   * (ADR 0006), so the figure is a human reading a dashboard. The system cannot
   * check that the reading is true. What it can do is refuse to let the reading
   * be skipped, and refuse an approval the reading says the money is not there
   * for -- which is the whole content of "an approval is checked against money
   * that actually exists".
   */
  describe('the provider balance the approving Admin read (prd-compliance 35)', () => {
    it('records the reading and which provider it came from, on the same write that approves', async () => {
      const { payoutState, prismaFor } = fundedPayout();

      await approvePayout(prismaFor() as never, {
        payoutId: 'payout-1',
        approvedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: 2_000_000,
      });

      // Same predicated update, same transaction: a Payout approved without the
      // reading beside it would leave nothing for a later audit to check the
      // approval against.
      expect(payoutState).toMatchObject({
        status: 'APPROVED',
        approvedProvider: 'sumopod',
        approvedProviderBalance: 2_000_000,
      });
    });

    it('approves when the reading covers the Payout, and does not require it to be exact', async () => {
      // Equal is not the rule; "at least this much is there" is. A provider
      // holding 2_000_000 for a 500_000 Payout is ordinary.
      const { prismaFor } = fundedPayout();

      await expect(
        approvePayout(prismaFor() as never, {
          payoutId: 'payout-1',
          approvedById: 'admin-1',
          provider: 'sumopod',
          providerBalance: 2_000_000,
        }),
      ).resolves.toMatchObject({ status: 'APPROVED' });
    });

    it('refuses an approval the reading says is not covered, and leaves the Payout exactly as it was', async () => {
      // The Campaign Balance says the Campaign is owed 500_000. The provider
      // says it is holding 400_000. Those disagree, and approving on the first
      // alone is how a Payout is approved against money that was never
      // collected -- which no ledger check can catch, because the ledger only
      // knows what it was told.
      const { rows, payoutState, prismaFor } = fundedPayout();

      await expect(
        approvePayout(prismaFor() as never, {
          payoutId: 'payout-1',
          approvedById: 'admin-1',
          provider: 'sumopod',
          providerBalance: 400_000,
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_BALANCE_INSUFFICIENT', payoutAmount: 500_000, providerBalance: 400_000 });

      // Untouched, right down to the reading: a refused approval leaves no trace
      // of the figure that was refused, so the next Admin starts from the
      // dashboard rather than from somebody else's number.
      expect(payoutState).toMatchObject({ status: 'DRAFT', approvedById: null });
      expect(payoutState).not.toHaveProperty('approvedProviderBalance');
      expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
    });

    it('refuses an approval with no reading at all, rather than approving on the Campaign Balance alone', async () => {
      const { rows, payoutState, prismaFor } = fundedPayout();

      await expect(
        approvePayout(prismaFor() as never, {
          payoutId: 'payout-1',
          approvedById: 'admin-1',
          provider: '',
          providerBalance: undefined as never,
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_BALANCE_NOT_RECORDED' });
      expect(payoutState).toMatchObject({ status: 'DRAFT' });
      expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
    });

    it('refuses a reading that is not whole rupiah above zero, as a figure that is not one', async () => {
      // A reading is a figure of money, not a claim about money: 1000.5 is
      // neither, and storing it would make a later reconciliation compare two
      // numbers that were never both real.
      //
      // Not "belum dicatat" -- these were recorded, and the Admin is told to
      // write down a reading they HAVE written down, which sends them back to
      // the dashboard to be told again the same thing. This is the same split
      // the withdrawal path already made: a field nobody filled in is one
      // error, a field filled in with something that is not that field's kind of
      // value is another.
      for (const providerBalance of [0, -1, 1000.5]) {
        const { payoutState, prismaFor } = fundedPayout();
        await expect(
          approvePayout(prismaFor() as never, {
            payoutId: 'payout-1',
            approvedById: 'admin-1',
            provider: 'sumopod',
            providerBalance,
          }),
        ).rejects.toMatchObject({ code: 'PROVIDER_BALANCE_AMOUNT_INVALID', providerBalance });
        expect(payoutState).toMatchObject({ status: 'DRAFT' });
      }
    });

    it('refuses a reading too large for the column it is stored in, and says it does not fit rather than that nothing was recorded', async () => {
      // approvedProviderBalance is an Int, so PostgreSQL's int4 ceiling is the
      // real limit on what a reading can be -- and the one this function was
      // missing. 5_000_000_000 passes every other check here, so it reached the
      // INSERT and came back as a driver error: a 500 for a figure that is not
      // a plausible reading anyway, and a 500 tells the Admin nothing about
      // which field to fix.
      //
      // The reading above is the harder half: this number WAS recorded, and it
      // only does not fit. Answering "belum dicatat" to an Admin who has just
      // written it down -- on a screen that also says it was recorded -- is the
      // kind of message that makes a person distrust the rest of the page.
      for (const providerBalance of [2_147_483_648, 5_000_000_000]) {
        const { payoutState, prismaFor } = fundedPayout();
        const error = await approvePayout(prismaFor() as never, {
          payoutId: 'payout-1',
          approvedById: 'admin-1',
          provider: 'sumopod',
          providerBalance,
        }).catch((err: unknown) => err);

        expect(error).toMatchObject({
          code: 'PROVIDER_BALANCE_AMOUNT_INVALID',
          providerBalance,
        });
        // The reason quotes the ceiling the column imposes, so the Admin is not
        // left guessing how far over they are -- and does not claim the reading
        // is missing.
        expect((error as Error).message).toContain('2.147.483.647');
        expect((error as Error).message).not.toMatch(/belum dicatat/i);
        expect(payoutState).toMatchObject({ status: 'DRAFT' });
      }
    });

    it('refuses a blank provider name as a name no provider answers to, not as a missing reading', async () => {
      // A reading arrived and the name did not. The reading was recorded, so
      // "belum dicatat" is false here too, and it is the same lie the new
      // blank-name branch inherited when it was added. What is missing is the
      // dashboard to compare the reading against, so this is the name's
      // refusal, and the same 400 an unregistered name already answers.
      for (const provider of ['', '   ']) {
        const { rows, payoutState, prismaFor } = fundedPayout();

        await expect(
          approvePayout(prismaFor() as never, {
            payoutId: 'payout-1',
            approvedById: 'admin-1',
            provider,
            providerBalance: 2_000_000,
          }),
        ).rejects.toMatchObject({ code: 'PROVIDER_NAME_UNKNOWN' });

        expect(payoutState).toMatchObject({ status: 'DRAFT', approvedById: null });
        expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
      }
    });

    it('accepts a reading at exactly the ceiling, because that is a real rupiah amount', async () => {
      // The boundary, stated from the column rather than from this test: one
      // rupiah above is refused and the ceiling itself is not, so the check
      // refuses what the column cannot hold and nothing beside it. Asserted on
      // the row as the approval left it, which is the number a later
      // reconciliation would read.
      const { prismaFor, payoutState } = fundedPayout();

      await approvePayout(prismaFor() as never, {
        payoutId: 'payout-1',
        approvedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: 2_147_483_647,
      });

      expect(payoutState).toMatchObject({
        status: 'APPROVED',
        approvedProviderBalance: 2_147_483_647,
      });
    });

    it('still refuses a self-approval, so a supplied reading never becomes a way past the two-person rule', async () => {
      // The reading is checked before the transaction opens, because it is a
      // property of the request rather than of any row. That means a caller who
      // supplies a perfectly good reading still reaches every check inside, and
      // a requester approving their own Payout is refused exactly as before.
      const { prismaFor } = fundedPayout({ requestedById: 'admin-1' });

      await expect(
        approvePayout(prismaFor() as never, {
          payoutId: 'payout-1',
          approvedById: 'admin-1',
          provider: 'sumopod',
          providerBalance: 2_000_000,
        }),
      ).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    });
  });

  /**
   * The provider NAME, which is a different rule from the reading above.
   *
   * `approvedProvider` is not a reconciliation datum: nothing sums by it, and
   * the sweep's reconciliation is the ledger's own, not this column's. So the
   * rule here is deliberately narrow -- one person must not be able to write
   * the same provider down two ways, and a name this build has no provider for
   * must not be written down at all. The column is read by a human at audit,
   * which is exactly why "Sumopod" and "sumopod" in the same file is a
   * finding rather than a cosmetic difference.
   */
  describe('the provider name the approving Admin typed', () => {
    it.each(['Sumopod', 'sumopod', ' Sumopod '])(
      'records %j as the one name the registry knows',
      async (provider) => {
        const { prismaFor, payoutState } = fundedPayout();

        await approvePayout(prismaFor() as never, {
          payoutId: 'payout-1',
          approvedById: 'admin-1',
          provider,
          providerBalance: 2_000_000,
        });

        expect(payoutState).toMatchObject({ status: 'APPROVED', approvedProvider: 'sumopod' });
      },
    );

    it('refuses a name this build has no provider for, rather than writing it on the row', async () => {
      // Free text was the failure: two Admins approving against two providers'
      // dashboards wrote two spellings of one provider, and a reader auditing
      // the column could not tell a typo from a second provider.
      const { rows, payoutState, prismaFor } = fundedPayout();

      await expect(
        approvePayout(prismaFor() as never, {
          payoutId: 'payout-1',
          approvedById: 'admin-1',
          provider: 'zendesk',
          providerBalance: 2_000_000,
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_NAME_UNKNOWN', provider: 'zendesk' });

      // Refused before the transaction opens, like a missing reading: the
      // Payout stays DRAFT, with nothing recorded and nothing posted.
      expect(payoutState).toMatchObject({ status: 'DRAFT', approvedById: null });
      expect(rows.filter((r) => r.transactionId === 'payout-instructed-payout-1')).toEqual([]);
    });

    it('names the provider the same way when the reading is short, so the refusal cannot be read as a different provider', async () => {
      // ProviderBalanceInsufficientError quotes the provider in its message.
      // The Admin is sent back to a dashboard, and the name they are told to go
      // to has to be the one the registry knows.
      const { prismaFor } = fundedPayout();

      await expect(
        approvePayout(prismaFor() as never, {
          payoutId: 'payout-1',
          approvedById: 'admin-1',
          provider: 'Sumopod',
          providerBalance: 400_000,
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_BALANCE_INSUFFICIENT', provider: 'sumopod' });
    });
  });

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
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 }),
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
        approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 }),
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

    const result = await approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 });

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

    const result = await approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 });

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

    await approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 });

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

    await approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 });

    const posted = rows.filter((r) => r.transactionId === 'payout-instructed-payout-1');
    expect(posted.every((r) => r.account !== 'TRIP_BALANCE')).toBe(true);
    expect(posted.find((r) => r.direction === 'DEBIT')).toMatchObject({ account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1' });
  });

  it('refuses self-approval for a Trip-linked payout exactly as it already does for a Campaign-linked one', async () => {
    const { tx } = makeTx({ payoutRow: basePayoutRow({ requestedById: 'same-person' }) });
    const prisma = makePrisma(tx, basePayoutRow());

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'same-person', provider: 'sumopod', providerBalance: 2_000_000 }),
    ).rejects.toThrow(SelfApprovalError);
  });

  it('throws PayoutNotFoundError for a nonexistent payout', async () => {
    const { tx } = makeTx({ payoutRow: null });
    const prisma = makePrisma(tx, {});

    await expect(
      approvePayout(prisma as never, { payoutId: 'missing', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 }),
    ).rejects.toThrow(PayoutNotFoundError);
  });

  it('throws InvalidPayoutStatusError for a Trip-linked payout that is not DRAFT', async () => {
    const { tx } = makeTx({ payoutRow: basePayoutRow({ status: 'APPROVED' }) });
    const prisma = makePrisma(tx, basePayoutRow({ status: 'APPROVED' }));

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 }),
    ).rejects.toThrow(InvalidPayoutStatusError);
  });

  it('refuses approval when the bank account is no longer eligible for a Trip-linked payout, re-checked at approval time', async () => {
    const { tx } = makeTx({ payoutRow: basePayoutRow({ bankAccount: { ...verifiedBankAccount(), verifiedAt: null } }) });
    const prisma = makePrisma(tx, basePayoutRow());

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 }),
    ).rejects.toThrow(BankAccountNotEligibleError);
  });

  it('rejects a Trip-linked payout when TRIP_BALANCE no longer covers it, re-checked after the lock', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 100_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const { tx } = makeTx({ ledgerRows, payoutRow: basePayoutRow({ amount: 500_000 }) });
    const prisma = makePrisma(tx, basePayoutRow({ amount: 500_000 }));

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 }),
    ).rejects.toThrow(InsufficientBalanceError);
  });

  it('throws for a malformed Payout row with both campaignId and volunteerTripId set (or neither) -- defends against a future writer that bypasses requestPayout\'s own guard', async () => {
    const { tx } = makeTx({ payoutRow: basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: 'trip-1' }) });
    const prisma = makePrisma(tx, basePayoutRow({ campaignId: 'campaign-1', volunteerTripId: 'trip-1' }));

    await expect(
      approvePayout(prisma as never, { payoutId: 'payout-1', approvedById: 'admin-1', provider: 'sumopod', providerBalance: 2_000_000 }),
    ).rejects.toThrow(InvalidPayoutSubjectError);
  });
});

/**
 * ticket 30 (ticket 02's answer, second half; FFI-07): an Admin explicitly
 * records "sudah dicek, kurang" as a pending decision, instead of leaving
 * only a refused approval with no trace that anyone looked. Nothing here
 * touches the Payout row -- the assertions below lean on that by checking
 * payoutUpdateMany/postTransaction-shaped effects are absent, the same way
 * the approvePayout tests above check nothing was posted on a refusal.
 */
describe('recordPayoutBalanceShort', () => {
  function draftPayoutRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'payout-1',
      campaignId: 'campaign-1',
      volunteerTripId: null,
      amount: 500_000,
      status: 'DRAFT',
      requestedById: 'requester-1',
      ...overrides,
    };
  }

  function prismaFrom(tx: ReturnType<typeof makeTx>['tx']) {
    return { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
  }

  it('records the reading, who checked and when, leaving the Payout DRAFT and untouched', async () => {
    const payoutRow = draftPayoutRow();
    const { tx, payoutBalanceChecks, payoutState } = makeTx({ payoutRow });

    const check = await recordPayoutBalanceShort(prismaFrom(tx) as never, {
      payoutId: 'payout-1',
      checkedById: 'admin-1',
      provider: 'sumopod',
      providerBalance: 300_000,
    });

    expect(check).toMatchObject({ payoutId: 'payout-1', checkedById: 'admin-1', provider: 'sumopod', recordedBalance: 300_000 });
    expect(payoutBalanceChecks).toHaveLength(1);
    // No write to the Payout row at all: still DRAFT, no approvedById.
    expect(payoutState).toMatchObject({ status: 'DRAFT' });
    expect(payoutState).not.toHaveProperty('approvedById');
  });

  it('refuses a reading that is not short of the Payout amount, and writes nothing', async () => {
    const payoutRow = draftPayoutRow({ amount: 500_000 });
    const { tx, payoutBalanceChecks } = makeTx({ payoutRow });

    await expect(
      recordPayoutBalanceShort(prismaFrom(tx) as never, {
        payoutId: 'payout-1',
        checkedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: 500_000,
      }),
    ).rejects.toThrow(ProviderBalanceNotShortError);
    expect(payoutBalanceChecks).toHaveLength(0);
  });

  it('refuses a Payout that is no longer DRAFT, the same refusal approvePayout raises', async () => {
    const payoutRow = draftPayoutRow({ status: 'APPROVED' });
    const { tx, payoutBalanceChecks } = makeTx({ payoutRow });

    await expect(
      recordPayoutBalanceShort(prismaFrom(tx) as never, {
        payoutId: 'payout-1',
        checkedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: 100_000,
      }),
    ).rejects.toThrow(InvalidPayoutStatusError);
    expect(payoutBalanceChecks).toHaveLength(0);
  });

  it('refuses the requester recording a check on their own Payout (same rule as who may approve)', async () => {
    const payoutRow = draftPayoutRow({ requestedById: 'requester-1' });
    const { tx, payoutBalanceChecks } = makeTx({ payoutRow });

    const attempt = recordPayoutBalanceShort(prismaFrom(tx) as never, {
      payoutId: 'payout-1',
      checkedById: 'requester-1',
      provider: 'sumopod',
      providerBalance: 100_000,
    });

    await expect(attempt).rejects.toThrow(SelfApprovalError);
    await expect(attempt).rejects.toMatchObject({ code: 'SELF_APPROVAL' });
    expect(payoutBalanceChecks).toHaveLength(0);
  });

  it('refuses the Campaign\'s own Fundraiser acting as Admin over it, the same Capacity judgement approvePayout asks', async () => {
    // The subject guard's default Campaign fixture is owned by 'requester-1'
    // (see makeTx); a different requestedById lets the check ask whether the
    // ACTING person, not the requester, owns the subject.
    const payoutRow = draftPayoutRow({ requestedById: 'someone-else' });
    const { tx, payoutBalanceChecks } = makeTx({ payoutRow });

    await expect(
      recordPayoutBalanceShort(prismaFrom(tx) as never, {
        payoutId: 'payout-1',
        checkedById: 'requester-1',
        provider: 'sumopod',
        providerBalance: 100_000,
      }),
    ).rejects.toThrow(OwnSubjectConflictError);
    expect(payoutBalanceChecks).toHaveLength(0);
  });

  it('refuses a missing reading as NOT_RECORDED, without ever reaching the Payout row', async () => {
    const payoutRow = draftPayoutRow();
    const { tx } = makeTx({ payoutRow });
    const payoutFindUniqueSpy = tx.payout.findUnique;

    await expect(
      recordPayoutBalanceShort(prismaFrom(tx) as never, {
        payoutId: 'payout-1',
        checkedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: NaN,
      }),
    ).rejects.toThrow(ProviderBalanceNotRecordedError);
    expect(payoutFindUniqueSpy).not.toHaveBeenCalled();
  });

  it('refuses a reading that is not whole rupiah above zero as AMOUNT_INVALID', async () => {
    const payoutRow = draftPayoutRow();
    const { tx } = makeTx({ payoutRow });

    await expect(
      recordPayoutBalanceShort(prismaFrom(tx) as never, {
        payoutId: 'payout-1',
        checkedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: 100.5,
      }),
    ).rejects.toThrow(ProviderBalanceAmountError);
  });

  it('refuses a provider name no provider answers to', async () => {
    const payoutRow = draftPayoutRow();
    const { tx } = makeTx({ payoutRow });

    await expect(
      recordPayoutBalanceShort(prismaFrom(tx) as never, {
        payoutId: 'payout-1',
        checkedById: 'admin-1',
        provider: 'not-a-real-provider',
        providerBalance: 100_000,
      }),
    ).rejects.toThrow(UnknownPaymentProviderNameError);
  });

  it('throws PayoutNotFoundError for a Payout that does not exist', async () => {
    const { tx } = makeTx({ payoutRow: null });

    await expect(
      recordPayoutBalanceShort(prismaFrom(tx) as never, {
        payoutId: 'payout-1',
        checkedById: 'admin-1',
        provider: 'sumopod',
        providerBalance: 100_000,
      }),
    ).rejects.toThrow(PayoutNotFoundError);
  });
});
