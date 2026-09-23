# Fundraiser withdraws a Trip's collected Trip Fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fundraiser can request a payout of their Volunteer Trip's withdrawable balance and see what's pending versus withdrawable, the same way they already can for a Campaign — same two-person rule, same review-before-transfer shape, same row-lock discipline.

**Architecture:** `src/lib/money/payouts.ts`'s `requestPayout`/`approvePayout` are Campaign-only today (both carry code comments literally marking "Needs a Trip-branch guard once a Volunteer Trip payout route exists"). This plan generalizes both to accept a `LedgerSubject` (`{type:'campaign', campaignId}` or `{type:'trip', tripId}` — the same discriminated union `lib/money/ledger.ts`'s leg-builders and `lib/money/escrow.ts`'s `releaseMaturedEscrow` already use, established in this branch's earlier tickets), in place rather than as a duplicate Trip-scoped sibling pair — matching this codebase's explicit precedent (ticket 01's leg-builders, ticket 03's `releaseMaturedEscrow`/webhook) of generalizing shared money-movement functions rather than forking them. `campaignBalance`/`tripBalance` and `escrowBalance`/`tripEscrowBalance` already exist in `lib/money/ledger.ts` (added by ticket 01) with zero callers surfacing them yet — this plan is their first caller. No schema migration: `Payout.campaignId`/`Payout.volunteerTripId` already exist with the exactly-one-of-two invariant already enforced by `assertExactlyOnePayoutSubject` (`lib/money/payout-subject.ts`, from ticket 01); neither the new Trip route nor the generalized `approvePayout` needs `.include()` through a real Prisma relation on `volunteerTripId` (it's compared as a plain scalar, exactly how `campaignId` is already used in the existing approve route) — the relation stays deferred, unneeded by this ticket despite an earlier ticket's plan flagging it as this ticket's likely job.

**Tech Stack:** Next.js, Prisma, Postgres, Vitest, Zod.

**Spec:** .scratch/volunteer-trip/spec.md (ticket: .scratch/volunteer-trip/issues/04-trip-fee-payout.md)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah di bawah keluar dengan status 0. Controller yang membaca header ini: kalau salah satu belum dijalankan, jalankan dulu; kalau ada yang gagal, perbaiki rencananya, jangan melewati gerbangnya.

    <akar specflow>/scripts/check-plan-headings.sh    <rencana ini> <task-brief>
    <akar specflow>/scripts/check-seam-constraints.sh <rencana ini> <task-brief>

## Global Constraints

- `requestPayout`/`approvePayout` (`src/lib/money/payouts.ts`) are generalized to take a `subject: LedgerSubject` (imported from `./ledger`) instead of a bare `campaignId`. `requestPayout`'s Campaign-only `DemoCampaignError` check stays gated to `subject.type === 'campaign'` only (Volunteer Trip has no `isDemo` field and no equivalent check). `BankAccountNotEligibleError`, `InsufficientBalanceError`, `SelfApprovalError`, `InvalidPayoutStatusError`, `PayoutNotFoundError` are unchanged and apply to both subjects identically. Balance is read via `campaignBalance`/`tripBalance` depending on `subject.type`. `Payout.create`'s data sets exactly one of `campaignId`/`volunteerTripId` matching the subject (never both, never neither — `assertExactlyOnePayoutSubject` is the existing guard for this invariant).
- `approvePayout`'s row-lock (currently `SELECT id FROM "Campaign" WHERE id = ${payout.campaignId} FOR UPDATE`) branches on which of `payout.campaignId`/`payout.volunteerTripId` is set: lock `"Campaign"` for a Campaign-linked Payout, lock `"VolunteerTrip"` for a Trip-linked one — same discipline `releaseMaturedEscrow`'s Trip branch (ticket 03) already established for exactly this class of lock. Balance re-check after the lock uses `campaignBalance`/`tripBalance` matching whichever subject the row is actually for. `payoutInstructedLegs` is called with the subject derived from the Payout row's own FK, never hardcoded to `'campaign'` — this is the exact mechanism that satisfies the cross-subject-leakage regression test (a Trip-linked Payout can only ever debit `TRIP_BALANCE`, a Campaign-linked one only `CAMPAIGN_BALANCE`, because the subject comes from which FK is actually non-null on that row).
- This is a breaking signature change to `requestPayout` (its one existing call site, `src/app/api/campaigns/[slug]/payouts/route.ts`, changes `campaignId: campaign.id` to `subject: { type: 'campaign', campaignId: campaign.id }`); `approvePayout`'s external signature (`{ payoutId, approvedById }`) does not change, since it already derives everything else from the Payout row it loads. Every existing Campaign-path test in `route.test.ts` and `[id]/approve/route.test.ts` must keep passing unchanged.
- `POST /api/volunteer-trips/[slug]/payouts` (new route): mirrors `POST /api/campaigns/[slug]/payouts` structurally — `withRoleCheck('CAMPAIGN_CREATOR', ...)` (the same role Fundraisers already hold; confirmed by the existing `POST .../batches` route's own ownership-check pattern), re-fetches the session inside the handler, looks up the Trip by slug, checks `trip.fundraiserId === userId` and returns 403 otherwise (no Admin bypass — mirrors the Campaign route's own owner-only gate exactly, it has none either), calls `releaseMaturedEscrow({ type: 'trip', id: trip.id })` before checking balance (the escrow-release-at-the-top-of-the-request pattern the ticket explicitly calls out), then `requestPayout` inside `prisma.$transaction` with `subject: { type: 'trip', tripId: trip.id }`. Same Zod body schema shape (`bankAccountId`, `amount`, `description`). Same error-to-status mapping (`BankAccountNotEligibleError`→403, `InsufficientBalanceError`→400), minus `DemoCampaignError` (not reachable for a Trip subject).
- `POST /api/volunteer-trips/[slug]/payouts/[id]/approve` (new route): mirrors `POST /api/campaigns/[slug]/payouts/[id]/approve` structurally — `withAssignmentCheck(Assignment.ADMIN, ...)`, loads the Trip by slug, loads the Payout by id and checks `payout.volunteerTripId === trip.id` (404 otherwise, mirroring the Campaign route's `payout.campaignId !== campaign.id` check — this is also what makes a Campaign-linked Payout 404 through this route, never approvable as a Trip payout), calls the generalized `approvePayout(prisma, { payoutId, approvedById })` unchanged (it derives its own subject from the row). Same error-to-status mapping as the Campaign approve route, minus the Demo case.
- `GET /api/volunteer-trips/[slug]/payouts` (new handler, same route file as the POST above — there is no existing Campaign-side equivalent to mirror; `lib/money/ledger.ts`'s own doc comment on `escrowBalance` says outright that no campaigner-facing balance surface exists anywhere yet, so this ticket's GET is the first caller of `tripBalance`/`tripEscrowBalance` for either subject type): same ownership gate as the POST in this file (owning Fundraiser only, no Admin bypass, 401/403 on failure), returns `{ escrowHold: number, tripBalance: number }` computed from `tripEscrowBalance`/`tripBalance`. No pagination, no payout list — just the two balance figures, matching the ticket's stated scope exactly.
- No schema change and no migration in this plan — see Architecture above for why `Payout.volunteerTripId` does not need its real `@relation` for this ticket's routes to work.
- Out of scope (unchanged from the parent spec, restated because this ticket touches the money layer): no payout `COMPLETED`/proof-of-transfer step for either subject (matches the Campaign route's own current end-state — approval is where the flow stops, per `approvePayout`'s existing doc comment on why no provider call happens); no Refund-cycle work; no Batch cancellation; no participation dashboard or UI of any kind; no i18n.

---

### Task 1: Generalize `lib/money/payouts.ts`'s `requestPayout`/`approvePayout` to a Campaign-or-Trip subject

**Files:**
- Modify: `src/lib/money/payouts.ts`
- Modify: `src/app/api/campaigns/[slug]/payouts/route.ts`
- Create: `src/lib/money/payouts.test.ts`

**Interfaces:**
- Consumes: `LedgerSubject`, `campaignBalance`, `tripBalance`, `payoutInstructedLegs`, `postTransaction` (all existing, `./ledger`); `assertExactlyOnePayoutSubject` (existing, `./payout-subject`).
- Produces: `requestPayout(tx: Prisma.TransactionClient, params: { subject: LedgerSubject; requestedById: string; bankAccountId: string; amount: number; description: string }): Promise<Payout>` — **breaking signature change** (was `campaignId: string` in place of `subject`), consumed by Task 2. `approvePayout(prisma: PrismaClient, params: { payoutId: string; approvedById: string }): Promise<Payout>` — **signature unchanged**, but now branches internally on the Payout row's own subject; consumed by Task 3.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah pemanggilan langsung terhadap `requestPayout` dan `approvePayout` (`src/lib/money/payouts.test.ts`, seam baru — modul ini sebelumnya hanya diuji tidak langsung lewat test route Campaign). Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: subject Campaign dan subject Trip untuk kedua fungsi, `DemoCampaignError` hanya untuk subject Campaign, setiap kelas error yang sudah ada (`BankAccountNotEligibleError`, `InsufficientBalanceError`, `SelfApprovalError`, `InvalidPayoutStatusError`, `PayoutNotFoundError`) untuk kedua subject, row-lock yang menyasar tabel yang benar (`"Campaign"` vs `"VolunteerTrip"`) per subject, dan regresi cross-subject-leakage (subject Trip tidak pernah bisa mendebit `CAMPAIGN_BALANCE` walau `CAMPAIGN_BALANCE` punya saldo besar, dan sebaliknya). Helper internal diuji secara tidak langsung lewat seam ini, tidak pernah langsung. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests for the generalized `requestPayout`/`approvePayout`**

```typescript
// src/lib/money/payouts.test.ts
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
      campaign: { findUnique: vi.fn().mockResolvedValue({ isDemo: options.isDemo ?? false }) },
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/money/payouts.test.ts`
Expected: FAIL — `requestPayout`/`approvePayout` do not accept a `subject` param yet (current signature takes bare `campaignId`); TypeScript errors and/or assertion failures on `volunteerTripId`.

- [ ] **Step 3: Implement the generalized `requestPayout`/`approvePayout`**

Read `src/lib/money/payouts.ts` in full first (already read during planning — reproduced below as the target state; keep every doc comment not shown here that isn't part of a changed block, e.g. the module header comment and every error class definition, unchanged):

Add to the top-of-file imports:

```typescript
import type { Payout, Prisma, PrismaClient } from '@/generated/prisma/client';
import { campaignBalance, tripBalance, payoutInstructedLegs, postTransaction, type LedgerSubject } from './ledger';
import { assertExactlyOnePayoutSubject } from './payout-subject';
```

Replace `requestPayout` in full:

```typescript
/**
 * The owning Fundraiser or Campaign creator requests a payout. Creates a
 * DRAFT and posts nothing to the ledger -- a request is not yet a movement
 * of money, only a proposal to make one. This function takes a
 * `Prisma.TransactionClient` because its caller (the route) wraps it in a
 * single `prisma.$transaction`; nothing here does external I/O, so there is
 * no reason to split it the way approval is split below.
 *
 * Generalized over `subject: LedgerSubject` rather than forked into a
 * Trip-scoped sibling: the isDemo check only applies to `subject.type ===
 * 'campaign'` (VolunteerTrip has no isDemo field and no equivalent), and the
 * balance read/subject FK branch on subject.type everywhere else. Every
 * other check -- bank account ownership and verification, the balance cap --
 * applies identically to both subjects.
 *
 * Ownership of the subject itself (campaign.creatorId === requestedById, or
 * trip.fundraiserId === requestedById) is the caller's responsibility:
 * withRoleCheck only proves "a CAMPAIGN_CREATOR-ranked user", not "this
 * subject's owner", so the route checks that before ever reaching here. What
 * this function owns is the destination account: `bankAccount.ownerId` must
 * equal `requestedById` too.
 *
 * Nothing is reserved against the balance here -- two DRAFT requests can be
 * created for more than the subject has. That is deliberate: the balance is
 * only ever spent at approval, and approvePayout is what actually closes the
 * "satisfiable twice" gap, under a lock, at the moment money would really
 * move.
 */
export async function requestPayout(
  tx: Prisma.TransactionClient,
  params: {
    subject: LedgerSubject;
    requestedById: string;
    bankAccountId: string;
    amount: number;
    description: string;
  },
): Promise<Payout> {
  const { subject, requestedById, bankAccountId, amount, description } = params;

  // Checked before the bank account and the balance, and only for a
  // Campaign subject -- a demo campaign has no ledger balance either, so
  // InsufficientBalanceError would already stop this -- but that message
  // reads as "the money isn't here yet", which sends whoever sees it
  // looking for a shortfall that does not exist. VolunteerTrip has no
  // isDemo field and no equivalent concept, so this check simply does not
  // run for a trip subject.
  if (subject.type === 'campaign') {
    const campaign = await tx.campaign.findUnique({
      where: { id: subject.campaignId },
      select: { isDemo: true },
    });
    if (campaign?.isDemo) {
      throw new DemoCampaignError();
    }
  }

  const bankAccount = await tx.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAccount || bankAccount.ownerId !== requestedById || !bankAccount.verifiedAt) {
    throw new BankAccountNotEligibleError();
  }

  // Never against Campaign.collectedAmount or any denormalized figure: this
  // figure counts lifetime donations and knows nothing about escrow,
  // refunds, or money already instructed out. Paying against it is how the
  // same money leaves twice. campaignBalance/tripBalance both derive strictly
  // from the ledger, scoped to this subject's own account -- a Trip subject
  // can never read a Campaign's balance or vice versa, because each function
  // filters on its own FK column.
  const balance =
    subject.type === 'campaign'
      ? await campaignBalance(tx, subject.campaignId)
      : await tripBalance(tx, subject.tripId);
  if (amount > balance) {
    throw new InsufficientBalanceError(amount, balance);
  }

  const subjectFk =
    subject.type === 'campaign'
      ? { campaignId: subject.campaignId, volunteerTripId: null }
      : { campaignId: null, volunteerTripId: subject.tripId };
  assertExactlyOnePayoutSubject(subjectFk);

  return tx.payout.create({
    data: {
      ...subjectFk,
      bankAccountId,
      amount,
      description,
      requestedById,
      status: 'DRAFT',
    },
  });
}
```

Replace `approvePayout` in full (keep the existing module-level doc comment above it — the "WHY NO PROVIDER CALL" explanation — unchanged; only the function body below changes):

```typescript
export async function approvePayout(
  prisma: PrismaClient,
  params: {
    payoutId: string;
    approvedById: string;
  },
): Promise<Payout> {
  const { payoutId, approvedById } = params;

  await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({
      where: { id: payoutId },
      include: { bankAccount: true },
    });
    if (!payout) {
      throw new PayoutNotFoundError(payoutId);
    }

    // The entire two-person rule, checked before any write: a self-approval
    // attempt leaves the payout completely untouched, because it is an
    // error, not a decision this payout has been through.
    if (payout.requestedById === approvedById) {
      throw new SelfApprovalError();
    }

    if (payout.status !== 'DRAFT') {
      throw new InvalidPayoutStatusError(payout.status);
    }

    // Re-checked here, not trusted from request time. Nothing in this repo
    // writes a BankAccount after creation except (by hand, outside the app)
    // clearing verifiedAt when one turns out to be fraudulent -- exactly the
    // scenario this exists to catch, in the window between a requester's
    // request and an admin's approval.
    const { bankAccount } = payout;
    if (!bankAccount || bankAccount.ownerId !== payout.requestedById || !bankAccount.verifiedAt) {
      throw new BankAccountNotEligibleError();
    }

    // Which subject this Payout actually belongs to -- exactly one of
    // campaignId/volunteerTripId is set (assertExactlyOnePayoutSubject
    // guards this at creation, in requestPayout above). This branch never
    // hardcodes 'campaign': it is what makes a Trip-linked Payout unable to
    // ever touch CAMPAIGN_BALANCE, and a Campaign-linked one unable to ever
    // touch TRIP_BALANCE, no matter how either was requested.
    const subject: LedgerSubject = payout.campaignId
      ? { type: 'campaign', campaignId: payout.campaignId }
      : { type: 'trip', tripId: payout.volunteerTripId! };

    // The contended resource is the subject's withdrawable BALANCE, not
    // this payout row -- a second, different DRAFT payout against the same
    // subject is a different row entirely and would sail straight past a
    // lock on this one. Locking the Campaign or VolunteerTrip row is what
    // serialises two admins approving two different payouts against the
    // same balance at once. Without it: campaignBalance/tripBalance below
    // is a plain SELECT ... GROUP BY with no row to lock, these
    // transactions run at Postgres's default READ COMMITTED, and two
    // concurrent approvals of two DIFFERENT payouts on the same subject
    // would each read the same pre-spend balance, each pass the check
    // below, and both commit -- the balance would go negative with nothing
    // to stop it, since balances are derived by summing entries, never
    // stored.
    if (subject.type === 'campaign') {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${subject.campaignId} FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM "VolunteerTrip" WHERE id = ${subject.tripId} FOR UPDATE`;
    }

    // Balance can have moved since the request -- a refund, another payout
    // approved first -- and, now that this transaction holds the subject's
    // row lock, this read is guaranteed current for as long as the lock is
    // held.
    const balance =
      subject.type === 'campaign'
        ? await campaignBalance(tx, subject.campaignId)
        : await tripBalance(tx, subject.tripId);
    if (payout.amount > balance) {
      throw new InsufficientBalanceError(payout.amount, balance);
    }

    // Still guarded on status too, even with the subject's row lock held:
    // the lock closes the cross-payout balance race above, this closes a
    // second approval of THIS SAME row racing in with a stale read of its
    // own. The loser sees count 0 and never reaches the ledger post below.
    const claimed = await tx.payout.updateMany({
      where: { id: payoutId, status: 'DRAFT' },
      data: { status: 'APPROVED', approvedById, approvedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new InvalidPayoutStatusError('unknown (changed concurrently)', 'lost the approval race');
    }

    // Posted at approval, not at completion. Money promised to a bank must
    // stop being withdrawable immediately, or the same balance can be
    // approved for payout twice. transactionId is keyed on the payout id so
    // this post can never happen twice, on top of (not instead of) the
    // updateMany guard above.
    await postTransaction(
      tx,
      payoutInstructedLegs({ subject, amount: payout.amount }),
      { payoutId: payout.id, transactionId: `payout-instructed-${payout.id}` },
    );
  });

  return prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/money/payouts.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Update the Campaign route's call site**

In `src/app/api/campaigns/[slug]/payouts/route.ts`, change the `requestPayout` call:

```typescript
    const payout = await prisma.$transaction((tx) =>
      requestPayout(tx, {
        subject: { type: 'campaign', campaignId: campaign.id },
        requestedById: userId,
        bankAccountId,
        amount,
        description,
      }),
    );
```

- [ ] **Step 6: Run the full suite to confirm no regression on the Campaign path**

Run: `npx vitest run`
Expected: PASS — the baseline (127 files / 1300 tests) plus this task's new `payouts.test.ts` tests, 0 failures. In particular `src/app/api/campaigns/[slug]/payouts/route.test.ts` and `src/app/api/campaigns/[slug]/payouts/[id]/approve/route.test.ts` pass unchanged — this is what proves the Campaign path is genuinely untouched, not just theoretically preserved.

- [ ] **Step 7: Commit**

```bash
git add src/lib/money/payouts.ts src/lib/money/payouts.test.ts src/app/api/campaigns/[slug]/payouts/route.ts
git commit -m "feat: generalize requestPayout/approvePayout to a Campaign-or-Trip subject

Both functions carried a comment marking the Trip-branch gap they've had
since the money-layer generalization ticket. requestPayout now takes a
subject: LedgerSubject (breaking change, one call site) instead of a bare
campaignId, gating the Campaign-only isDemo check to subject.type ===
'campaign'. approvePayout's external signature is unchanged -- it derives
its subject from whichever of the Payout row's campaignId/volunteerTripId
is actually set, and branches its row-lock (Campaign vs VolunteerTrip),
balance check, and payoutInstructedLegs call on that subject. This is the
exact mechanism that makes a Trip-linked Payout structurally unable to
debit CAMPAIGN_BALANCE, and vice versa -- covered by a new direct-seam
payouts.test.ts, this module's first.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `POST` and `GET /api/volunteer-trips/[slug]/payouts`

**Files:**
- Create: `src/app/api/volunteer-trips/[slug]/payouts/route.ts`
- Create: `src/app/api/volunteer-trips/[slug]/payouts/route.test.ts`

**Interfaces:**
- Consumes: `requestPayout` (`subject: LedgerSubject`), `BankAccountNotEligibleError`, `InsufficientBalanceError` (Task 1, `@/lib/money/payouts`); `releaseMaturedEscrow` (existing, `@/lib/money/escrow`); `tripBalance`, `tripEscrowBalance` (existing, `@/lib/money/ledger`); `withRoleCheck` (existing, `@/lib/withRoleCheck`); `getServerSession` (existing, `@/lib/auth`).
- Produces: `POST /api/volunteer-trips/[slug]/payouts`, `GET /api/volunteer-trips/[slug]/payouts` — no other task consumes these directly (Task 3 is a sibling route, not a caller).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler yang diekspor (`POST`, `GET`), diimpor dan dipanggil langsung dengan `@/lib/prisma` dan `@/lib/auth` di-mock, persis gaya `src/app/api/campaigns/[slug]/payouts/route.test.ts` (baca berkas itu secara penuh sebelum menulis test ini). Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: setiap status gagal (401, 403 role, 403 bukan pemilik, 400 body tidak valid, 404 trip tidak ada), sweep escrow di awal request, penolakan saat saldo tidak cukup, penciptaan payout DRAFT yang benar (`volunteerTripId` terisi, `campaignId` null), regresi cross-subject-leakage pada level route, dan `GET` yang mengembalikan `escrowHold`/`tripBalance` yang benar dari ledger nyata. Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/volunteer-trips/[slug]/payouts/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    payment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockPaymentFindMany = prisma.payment.findMany as unknown as Mock;
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

function makeTx(options: { ledgerRows?: LedgerRow[]; bankAccount?: Record<string, unknown> | null } = {}) {
  const rows: LedgerRow[] = [...(options.ledgerRows ?? [])];
  const bankAccountFindUnique = vi.fn().mockResolvedValue(options.bankAccount ?? null);
  const payoutCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'payout-1',
    createdAt: new Date(),
    ...data,
  }));
  return {
    tx: {
      bankAccount: { findUnique: bankAccountFindUnique },
      payout: { create: payoutCreate },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
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
    bankAccountFindUnique,
    payoutCreate,
    rows,
  };
}

function verifiedBankAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bank-1',
    ownerId: 'fundraiser-1',
    bankCode: 'BCA',
    accountNumber: '1234567890',
    accountName: 'Fundraiser One',
    verifiedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/test-trip/payouts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/test-trip/payouts', { method: 'GET' });
}

function routeContext() {
  return { params: Promise.resolve({ slug: 'test-trip' }) };
}

const VALID_BODY = { bankAccountId: 'bank-1', amount: 200_000, description: 'Pencairan trip' };

describe('POST /api/volunteer-trips/[slug]/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1', role: 'CAMPAIGN_CREATOR' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'fundraiser-1' });
    mockPaymentFindMany.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a role below CAMPAIGN_CREATOR', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'donor-1', role: 'DONOR' } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is a CAMPAIGN_CREATOR but not this Trip's Fundraiser", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid body without ever resolving the trip', async () => {
    const response = await POST(postRequest({ bankAccountId: '', amount: -5, description: '' }), routeContext());
    expect(response.status).toBe(400);
    expect(mockTripFindUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY), routeContext());
    expect(response.status).toBe(404);
  });

  it('rejects an unverified bank account with 403 and creates nothing', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount({ verifiedAt: null }) });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(403);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('rejects an amount over the withdrawable TRIP_BALANCE with 400, checked against the ledger', async () => {
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows: [] });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest({ ...VALID_BODY, amount: 1 }), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/saldo/i);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('REGRESSION: a Trip payout cannot be requested for more than the current TRIP_BALANCE, even when another Trip has ample TRIP_BALANCE rows', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 5_000_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'a-different-trip' },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest({ ...VALID_BODY, amount: 1 }), routeContext());

    expect(response.status).toBe(400);
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('creates a DRAFT payout with volunteerTripId set (never campaignId) when the balance covers it', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 200_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
    ];
    const { tx, payoutCreate } = makeTx({ bankAccount: verifiedBankAccount(), ledgerRows });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.status).toBe('DRAFT');
    expect(payoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ volunteerTripId: 'trip-1', campaignId: null, bankAccountId: 'bank-1', amount: 200_000, status: 'DRAFT' }),
      }),
    );
  });

  it('releases a matured escrow hold for this Trip before checking the withdrawable balance', async () => {
    mockPaymentFindMany.mockResolvedValue([
      {
        id: 'payment-1',
        amount: 200_000,
        providerFee: 0,
        donationId: null,
        registrationId: 'registration-1',
        donation: null,
        registration: { batch: { tripId: 'trip-1' } },
      },
    ]);
    const { tx, payoutCreate, rows } = makeTx({
      bankAccount: verifiedBankAccount(),
      ledgerRows: [
        { transactionId: 'settle-1', direction: 'CREDIT', amount: 200_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      ],
    });
    tx.payment.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(postRequest(VALID_BODY), routeContext());

    expect(response.status).toBe(201);
    expect(payoutCreate).toHaveBeenCalled();
    const releaseLegs = rows.filter((r) => r.transactionId === 'escrow-release:payment-1');
    expect(releaseLegs).toHaveLength(2);
  });
});

describe('GET /api/volunteer-trips/[slug]/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1', role: 'CAMPAIGN_CREATOR' } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1', fundraiserId: 'fundraiser-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(401);
  });

  it("returns 403 when the caller is not this Trip's Fundraiser", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'someone-else', role: 'CAMPAIGN_CREATOR' } });
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(403);
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await GET(getRequest(), routeContext());
    expect(response.status).toBe(404);
  });

  it('returns escrowHold and tripBalance computed from the real ledger, never leaking a Campaign row', async () => {
    const ledgerRows: LedgerRow[] = [
      { transactionId: 't1', direction: 'CREDIT', amount: 300_000, account: 'ESCROW_HOLD', campaignId: null, volunteerTripId: 'trip-1' },
      { transactionId: 't2', direction: 'CREDIT', amount: 150_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
      { transactionId: 't3', direction: 'CREDIT', amount: 9_999_999, account: 'CAMPAIGN_BALANCE', campaignId: 'campaign-1', volunteerTripId: null },
    ];
    const { tx } = makeTx({ ledgerRows });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await GET(getRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ escrowHold: 300_000, tripBalance: 150_000 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/payouts/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/volunteer-trips/[slug]/payouts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withRoleCheck } from '@/lib/withRoleCheck';
import { requestPayout, BankAccountNotEligibleError, InsufficientBalanceError } from '@/lib/money/payouts';
import { releaseMaturedEscrow } from '@/lib/money/escrow';
import { tripBalance, tripEscrowBalance } from '@/lib/money/ledger';

const requestPayoutSchema = z.object({
  bankAccountId: z.string().min(1, 'Rekening bank harus dipilih'),
  amount: z.number().int('Jumlah harus berupa bilangan bulat').min(1, 'Jumlah pencairan harus lebih dari 0'),
  description: z.string().min(1, 'Keterangan harus diisi').max(500, 'Keterangan maksimal 500 karakter'),
});

/**
 * POST /api/volunteer-trips/[slug]/payouts -- the owning Fundraiser requests
 * a payout of their Trip's withdrawable TRIP_BALANCE.
 *
 * Mirrors POST /api/campaigns/[slug]/payouts exactly, including the
 * escrow-release-at-the-top-of-the-request pattern: withRoleCheck only
 * proves "a CAMPAIGN_CREATOR-ranked user", not "this Trip's Fundraiser", so
 * getServerSession is called again here and the ownership check below is
 * what actually stops one Fundraiser from draining another's Trip.
 */
export const POST = withRoleCheck('CAMPAIGN_CREATOR', async (request: NextRequest, context: any) => {
  const { slug } = await context.params;
  const session = await getServerSession();
  const userId = session!.user!.id as string;

  const body = await request.json().catch(() => null);
  const parsed = requestPayoutSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
  }
  const { bankAccountId, amount, description } = parsed.data;

  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    select: { id: true, fundraiserId: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }
  if (trip.fundraiserId !== userId) {
    return NextResponse.json({ error: 'Anda tidak berhak mengajukan pencairan untuk trip ini' }, { status: 403 });
  }

  try {
    // No scheduler exists in this repo -- this is what makes a Trip's
    // 7-day escrow hold actually let go of money before its balance is
    // checked, the same reasoning the Campaign route already documents.
    await releaseMaturedEscrow({ type: 'trip', id: trip.id });

    const payout = await prisma.$transaction((tx) =>
      requestPayout(tx, {
        subject: { type: 'trip', tripId: trip.id },
        requestedById: userId,
        bankAccountId,
        amount,
        description,
      }),
    );

    return NextResponse.json(
      {
        id: payout.id,
        volunteerTripId: payout.volunteerTripId,
        bankAccountId: payout.bankAccountId,
        amount: payout.amount,
        description: payout.description,
        status: payout.status,
        createdAt: payout.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BankAccountNotEligibleError) {
      return NextResponse.json(
        { error: 'Rekening bank tidak valid, bukan milik Anda, atau belum terverifikasi' },
        { status: 403 },
      );
    }
    if (error instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: 'Saldo trip tidak mencukupi untuk jumlah pencairan ini' }, { status: 400 });
    }
    console.error('Error requesting trip payout:', error);
    return NextResponse.json({ error: 'Gagal mengajukan pencairan' }, { status: 500 });
  }
});

/**
 * GET /api/volunteer-trips/[slug]/payouts -- the owning Fundraiser sees
 * their Trip's Escrow Hold (settled money still inside the 7-day dispute
 * window) versus its Trip Balance (actually withdrawable). First caller of
 * tripEscrowBalance/tripBalance -- no equivalent surface exists on the
 * Campaign side yet either (see lib/money/ledger.ts's own doc comment on
 * escrowBalance, which says outright nothing has surfaced it so far).
 */
export const GET = withRoleCheck('CAMPAIGN_CREATOR', async (_request: NextRequest, context: any) => {
  const { slug } = await context.params;
  const session = await getServerSession();
  const userId = session!.user!.id as string;

  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    select: { id: true, fundraiserId: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }
  if (trip.fundraiserId !== userId) {
    return NextResponse.json({ error: 'Anda tidak berhak melihat saldo trip ini' }, { status: 403 });
  }

  const [escrowHold, tripBalanceAmount] = await prisma.$transaction((tx) =>
    Promise.all([tripEscrowBalance(tx, trip.id), tripBalance(tx, trip.id)]),
  );

  return NextResponse.json({ escrowHold, tripBalance: tripBalanceAmount });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/payouts/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS, baseline plus this task's and Task 1's new tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/volunteer-trips/[slug]/payouts/route.ts src/app/api/volunteer-trips/[slug]/payouts/route.test.ts
git commit -m "feat: Fundraiser requests a Trip payout and sees Escrow Hold / Trip Balance

POST /api/volunteer-trips/[slug]/payouts mirrors the Campaign payout route
exactly -- role gate, ownership check, releaseMaturedEscrow at the top of
the request, then the now-generalized requestPayout with a trip subject.
GET on the same route is the first caller of tripEscrowBalance/tripBalance
anywhere in the app -- no equivalent surface exists for Campaign yet
either.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `POST /api/volunteer-trips/[slug]/payouts/[id]/approve` -- the two-person rule and row lock

**Files:**
- Create: `src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.ts`
- Create: `src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.test.ts`

**Interfaces:**
- Consumes: `approvePayout`, `BankAccountNotEligibleError`, `InsufficientBalanceError`, `InvalidPayoutStatusError`, `PayoutNotFoundError`, `SelfApprovalError` (Task 1, `@/lib/money/payouts`); `withAssignmentCheck` (existing, `@/lib/withAssignmentCheck`); `Assignment` (existing, `@/generated/prisma/client`).
- Produces: `POST /api/volunteer-trips/[slug]/payouts/[id]/approve` — no other task consumes this.

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah route handler `POST` yang diekspor, diimpor dan dipanggil langsung dengan `@/lib/prisma` dan `@/lib/auth` di-mock, persis gaya `src/app/api/campaigns/[slug]/payouts/[id]/approve/route.test.ts` (baca berkas itu secara penuh sebelum menulis test ini, termasuk test konkurensi FIFO-mutex-nya). Cakup SETIAP perilaku dan edge case task ini MELALUI seam itu: 401, 403 (assignment Admin hilang), 404 trip tidak ada, 404 payout tidak milik trip ini (termasuk regresi eksplisit: payout yang sebenarnya milik Campaign tidak pernah bisa disetujui lewat route Trip ini), penolakan self-approval, status bukan DRAFT (409), rekening bank tidak lagi memenuhi syarat, saldo tidak lagi cukup dicek ulang setelah lock, persetujuan sukses dengan legs yang benar dan lock yang menyasar `"VolunteerTrip"` (bukan `"Campaign"`), dan test konkurensi genuin (dua payout DRAFT berbeda pada Trip yang sama, disetujui bersamaan, tepat satu berhasil). Nilai harapan dalam test harus literal yang diketahui, bukan dihitung ulang dengan cara yang sama seperti kode.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    volunteerTrip: { findUnique: vi.fn() },
    payout: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockTripFindUnique = prisma.volunteerTrip.findUnique as unknown as Mock;
const mockPayoutFindUnique = prisma.payout.findUnique as unknown as Mock;
const mockPayoutUpdateManyTop = prisma.payout.updateMany as unknown as Mock;
const mockPayoutFindUniqueOrThrow = prisma.payout.findUniqueOrThrow as unknown as Mock;
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

function makePayoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    campaignId: null,
    volunteerTripId: 'trip-1',
    amount: 200_000,
    description: 'Pencairan trip',
    status: 'DRAFT',
    requestedById: 'fundraiser-1',
    approvedById: null,
    approvedAt: null,
    providerRef: null,
    bankAccount: {
      id: 'bank-1',
      ownerId: 'fundraiser-1',
      bankCode: 'BCA',
      accountNumber: '1234567890',
      accountName: 'Fundraiser One',
      verifiedAt: new Date('2026-01-01'),
    },
    ...overrides,
  };
}

function makeTx(options: { payout: ReturnType<typeof makePayoutRow> | null; ledgerRows?: LedgerRow[]; updateManyCount?: number }) {
  const { payout, ledgerRows = [], updateManyCount = 1 } = options;
  const rows: LedgerRow[] = [...ledgerRows];
  const state = payout ? { ...payout } : null;

  const findUnique = vi.fn().mockResolvedValue(state);
  const updateMany = vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
    if (!state || updateManyCount === 0 || state.status !== where.status) {
      return { count: 0 };
    }
    Object.assign(state, data);
    return { count: 1 };
  });
  const queryRawCalls: string[] = [];
  const queryRaw = vi.fn((strings: TemplateStringsArray) => {
    queryRawCalls.push(strings.join(''));
    return Promise.resolve([{ id: payout?.volunteerTripId ?? 'trip-1' }]);
  });

  return {
    tx: {
      payout: { findUnique, updateMany },
      $queryRaw: queryRaw,
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
    state,
    ledgerRows: rows,
    updateMany,
    queryRaw,
    queryRawCalls,
  };
}

/** A strict FIFO async mutex, used only by the genuine-concurrency test below -- copied from src/app/api/campaigns/[slug]/payouts/[id]/approve/route.test.ts's own helper of the same name. */
function makeMutex() {
  let tail: Promise<void> = Promise.resolve();
  return {
    enter(): Promise<() => void> {
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      const acquired = tail.then(() => release);
      tail = next;
      return acquired;
    },
  };
}

function createRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/volunteer-trips/test-trip/payouts/payout-1/approve', { method: 'POST' });
}

function routeContext(id = 'payout-1') {
  return { params: Promise.resolve({ slug: 'test-trip', id }) };
}

const FULL_BALANCE_ROWS: LedgerRow[] = [
  { transactionId: 't1', direction: 'CREDIT', amount: 200_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' },
];

describe('POST /api/volunteer-trips/[slug]/payouts/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });
    mockTripFindUnique.mockResolvedValue({ id: 'trip-1' });
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: 'trip-1' });
    mockPayoutUpdateManyTop.mockResolvedValue({ count: 1 });
    mockPayoutFindUniqueOrThrow.mockResolvedValue(makePayoutRow({ status: 'APPROVED', approvedById: 'admin-1' }));
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 for a Verifier who does not hold the Admin assignment', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'mod-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the trip does not exist', async () => {
    mockTripFindUnique.mockResolvedValue(null);
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the payout does not belong to this trip', async () => {
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: 'a-different-trip' });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('REGRESSION: returns 404 when the payout is actually Campaign-linked (volunteerTripId null) -- a Campaign Payout can never be approved through the Trip route', async () => {
    mockPayoutFindUnique.mockResolvedValue({ volunteerTripId: null });
    const response = await POST(createRequest(), routeContext());
    expect(response.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('refuses self-approval with 403 and leaves the payout completely untouched', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1', role: 'ADMIN', assignments: ['ADMIN'] } });
    const { tx, updateMany, queryRaw } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/mengajukan/i);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('refuses to approve a payout that is not DRAFT with 409', async () => {
    const { tx, updateMany, queryRaw } = makeTx({ payout: makePayoutRow({ status: 'COMPLETED' }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses approval when the bank account is no longer eligible with 403', async () => {
    const { tx, updateMany } = makeTx({
      payout: makePayoutRow({ bankAccount: { ...makePayoutRow().bankAccount, verifiedAt: null } }),
      ledgerRows: FULL_BALANCE_ROWS,
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/rekening/i);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects approval when TRIP_BALANCE no longer covers it, re-checked at approval time', async () => {
    const { tx, updateMany, queryRaw } = makeTx({
      payout: makePayoutRow({ amount: 200_000 }),
      ledgerRows: [{ transactionId: 't1', direction: 'CREDIT', amount: 40_000, account: 'TRIP_BALANCE', campaignId: null, volunteerTripId: 'trip-1' }],
    });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/saldo/i);
    expect(queryRaw).toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('approves: locks "VolunteerTrip" (never "Campaign"), posts TRIP_BALANCE debit / PAYOUT_CLEARING credit, balance drops to zero', async () => {
    const { tx, ledgerRows, queryRaw, queryRawCalls } = makeTx({ payout: makePayoutRow({ amount: 200_000 }), ledgerRows: FULL_BALANCE_ROWS });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('APPROVED');
    expect(queryRaw).toHaveBeenCalled();
    expect(queryRawCalls.some((q) => q.includes('VolunteerTrip'))).toBe(true);
    expect(queryRawCalls.some((q) => q.includes('"Campaign"'))).toBe(false);

    const posted = ledgerRows.filter((r) => r.transactionId !== 't1');
    expect(posted).toEqual([
      expect.objectContaining({ account: 'TRIP_BALANCE', direction: 'DEBIT', amount: 200_000, volunteerTripId: 'trip-1', campaignId: null }),
      expect.objectContaining({ account: 'PAYOUT_CLEARING', direction: 'CREDIT', amount: 200_000 }),
    ]);
    expect(posted[0].transactionId).toBe('payout-instructed-payout-1');

    const finalBalance = await import('@/lib/money/ledger').then((m) => m.tripBalance(tx as never, 'trip-1'));
    expect(finalBalance).toBe(0);
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('a second approval that loses the race changes nothing', async () => {
    const { tx } = makeTx({ payout: makePayoutRow(), ledgerRows: FULL_BALANCE_ROWS, updateManyCount: 0 });
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
    expect(mockPayoutUpdateManyTop).not.toHaveBeenCalled();
  });

  it('does not let two different DRAFT payouts on one Trip both spend the same TRIP_BALANCE when approved concurrently', async () => {
    const payoutRows = new Map<string, ReturnType<typeof makePayoutRow>>([
      ['payout-a', makePayoutRow({ id: 'payout-a', amount: 200_000 })],
      ['payout-b', makePayoutRow({ id: 'payout-b', amount: 200_000 })],
    ]);
    const ledgerRows: LedgerRow[] = [...FULL_BALANCE_ROWS];
    const mutex = makeMutex();
    const lockBox: { release?: () => void } = {};

    const sharedTx = {
      payout: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = payoutRows.get(where.id);
          return row ? { ...row } : null;
        }),
        updateMany: vi.fn(
          async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
            const row = payoutRows.get(where.id);
            if (!row || row.status !== where.status) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          },
        ),
      },
      $queryRaw: vi.fn(async () => {
        lockBox.release = await mutex.enter();
        return [{ id: 'trip-1' }];
      }),
      ledgerEntry: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
          ledgerRows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
          const filtered = ledgerRows.filter((r) => {
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
    };

    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      try {
        return await cb(sharedTx);
      } finally {
        lockBox.release?.();
        lockBox.release = undefined;
      }
    });
    mockPayoutFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const row = payoutRows.get(where.id);
      return row ? { volunteerTripId: row.volunteerTripId } : null;
    });
    mockPayoutUpdateManyTop.mockImplementation(
      async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const row = payoutRows.get(where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    );
    mockPayoutFindUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      ...payoutRows.get(where.id),
    }));

    const [responseA, responseB] = await Promise.all([
      POST(createRequest(), routeContext('payout-a')),
      POST(createRequest(), routeContext('payout-b')),
    ]);
    const statuses = [responseA.status, responseB.status].sort();

    expect(statuses).toEqual([200, 400]);

    const finalBalance = await import('@/lib/money/ledger').then((m) => m.tripBalance(sharedTx as never, 'trip-1'));
    expect(finalBalance).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import {
  approvePayout,
  BankAccountNotEligibleError,
  InsufficientBalanceError,
  InvalidPayoutStatusError,
  PayoutNotFoundError,
  SelfApprovalError,
} from '@/lib/money/payouts';

/**
 * POST /api/volunteer-trips/[slug]/payouts/[id]/approve -- an Admin approves
 * a DRAFT Trip payout and releases it in the same action.
 *
 * Mirrors POST /api/campaigns/[slug]/payouts/[id]/approve exactly:
 * withAssignmentCheck(Assignment.ADMIN) gates on the assignment only and
 * does not pass the session to the handler, so getServerSession is called
 * again here to learn who is approving -- that identity is what the
 * two-person check inside approvePayout compares against requestedById.
 * approvePayout itself already branches on which of
 * campaignId/volunteerTripId the Payout row has set, so no Trip-specific
 * call is needed here beyond loading the row and checking it belongs to
 * this Trip.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (_request: NextRequest, context: any) => {
  const { slug, id } = await context.params;
  const session = await getServerSession();
  const approvedById = session!.user!.id as string;

  const trip = await prisma.volunteerTrip.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!trip) {
    return NextResponse.json({ error: 'Volunteer trip tidak ditemukan' }, { status: 404 });
  }

  const payout = await prisma.payout.findUnique({ where: { id }, select: { volunteerTripId: true } });
  if (!payout || payout.volunteerTripId !== trip.id) {
    return NextResponse.json({ error: 'Payout tidak ditemukan' }, { status: 404 });
  }

  try {
    const updated = await approvePayout(prisma, { payoutId: id, approvedById });

    return NextResponse.json({
      id: updated.id,
      volunteerTripId: updated.volunteerTripId,
      amount: updated.amount,
      status: updated.status,
      approvedById: updated.approvedById,
      approvedAt: updated.approvedAt,
      providerRef: updated.providerRef,
    });
  } catch (error) {
    if (error instanceof PayoutNotFoundError) {
      return NextResponse.json({ error: 'Payout tidak ditemukan' }, { status: 404 });
    }
    if (error instanceof SelfApprovalError) {
      return NextResponse.json(
        { error: 'Payout tidak dapat disetujui oleh orang yang mengajukannya' },
        { status: 403 },
      );
    }
    if (error instanceof InvalidPayoutStatusError) {
      return NextResponse.json({ error: 'Payout tidak lagi menunggu persetujuan' }, { status: 409 });
    }
    if (error instanceof InsufficientBalanceError) {
      return NextResponse.json({ error: 'Saldo trip tidak lagi mencukupi untuk pencairan ini' }, { status: 400 });
    }
    if (error instanceof BankAccountNotEligibleError) {
      return NextResponse.json({ error: 'Rekening tujuan tidak lagi memenuhi syarat' }, { status: 403 });
    }
    console.error('Error approving trip payout:', error);
    return NextResponse.json({ error: 'Gagal menyetujui pencairan' }, { status: 500 });
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS, baseline plus every new test from Tasks 1, 2, and 3, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.ts" "src/app/api/volunteer-trips/[slug]/payouts/[id]/approve/route.test.ts"
git commit -m "feat: Admin approves a Trip payout under the same two-person rule as Campaign

POST /api/volunteer-trips/[slug]/payouts/[id]/approve mirrors the Campaign
approve route exactly -- ADMIN assignment gate, ownership check against
this Trip (a Campaign-linked Payout 404s here, never approvable through
this route), then the now-subject-aware approvePayout. Includes the same
row-lock discipline (VolunteerTrip, not Campaign) and a genuine-concurrency
test proving two DRAFT payouts on one Trip can't both spend the same
TRIP_BALANCE when approved at once.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
