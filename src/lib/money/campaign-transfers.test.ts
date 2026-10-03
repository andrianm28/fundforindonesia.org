import { describe, it, expect, vi } from 'vitest';
import {
  requestCampaignTransfer,
  approveCampaignTransfer,
  rejectCampaignTransfer,
  CampaignTransferBalanceChangedError,
  CampaignTransferCategoryMismatchError,
  CampaignTransferCrossKindError,
  CampaignTransferInvalidError,
  CampaignTransferKindNotTransferableError,
  CampaignTransferNotFoundError,
  CampaignTransferNotPendingError,
  CampaignTransferSourceNotSuspendedError,
  CampaignTransferTargetNotEligibleError,
  DemoCampaignError,
  InsufficientBalanceError,
  OwnSubjectConflictError,
  SelfApprovalError,
} from './campaign-transfers';
import { requireKindAndDeadlineEditable, KindImmutableError } from '../subject-guard';
import { ledgerGroupBy } from '../../../tests/support/ledger-group-by';

/**
 * Campaign Transfer (prd-compliance 33; PRD §7.2; ADR 0015): a Suspended zakat
 * or wakaf Campaign's money moves to another Campaign of the same Kind instead
 * of back to Donors.
 *
 * What these pin, in the order an Admin meets it:
 *  - the Kind rules are the domain's, refused outright: zakat to zakat, wakaf
 *    to wakaf of the same category, never across Kinds;
 *  - one Admin requests (nothing moves), a different Admin approves, and only
 *    approval posts a balanced journal -- never an edit of a balance;
 *  - both Campaigns are locked in one fixed order, and everything is re-judged
 *    under those locks, so a Suspension lifted between request and approval
 *    still stops the money;
 *  - every affected Donor is told where their money went.
 */

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  campaignTransferId: string | null;
};

type CampaignFixture = {
  creatorId: string;
  isDemo: boolean;
  lifecycleStatus: string;
  kind: string;
  category: string;
  title: string;
  slug: string;
};

const SOURCE = 'campaign-b'; // sorts AFTER target on purpose: lock order is by id, not by role
const TARGET = 'campaign-a';

function campaign(overrides: Partial<CampaignFixture> = {}): CampaignFixture {
  return {
    creatorId: 'fundraiser-x',
    isDemo: false,
    lifecycleStatus: 'ACTIVE',
    kind: 'ZAKAT',
    category: 'Zakat Maal',
    title: 'Campaign',
    slug: 'campaign',
    ...overrides,
  };
}

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ct-1',
    sourceId: SOURCE,
    targetId: TARGET,
    amount: 400_000,
    reason: 'Campaign asal disuspend',
    status: 'PENDING',
    requestedById: 'admin-1',
    decidedById: null as string | null,
    decidedAt: null as Date | null,
    decisionReason: null as string | null,
    createdAt: new Date('2026-10-01'),
    ...overrides,
  };
}

function makeTx(
  options: {
    row?: Record<string, unknown> | null;
    source?: Partial<CampaignFixture>;
    target?: Partial<CampaignFixture>;
    /** Net CAMPAIGN_BALANCE the source holds. */
    sourceBalance?: number;
    donors?: Array<{ donorId: string | null }>;
    guests?: Array<Record<string, unknown>>;
    /** Other money the source holds: Escrow Hold, money frozen for a Refund. */
    extraRows?: Array<{ account: string; direction: 'DEBIT' | 'CREDIT'; amount: number }>;
  } = {},
) {
  const campaigns: Record<string, CampaignFixture> = {
    [SOURCE]: campaign({ lifecycleStatus: 'SUSPENDED', title: 'Zakat Sumber', slug: 'zakat-sumber', ...options.source }),
    [TARGET]: campaign({ creatorId: 'fundraiser-y', title: 'Zakat Tujuan', slug: 'zakat-tujuan', ...options.target }),
  };
  const rows: LedgerRow[] = [];
  if (options.sourceBalance !== 0) {
    rows.push({
      transactionId: 'seed',
      direction: 'CREDIT',
      amount: options.sourceBalance ?? 400_000,
      account: 'CAMPAIGN_BALANCE',
      campaignId: SOURCE,
      campaignTransferId: null,
    });
  }
  for (const extra of options.extraRows ?? []) {
    rows.push({ transactionId: 'seed-extra', campaignId: SOURCE, campaignTransferId: null, ...extra });
  }
  const state = options.row === undefined ? transfer() : options.row ? { ...options.row } : null;
  const lockOrder: string[] = [];
  const events: string[] = [];

  const tx = {
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      lockOrder.push(String(values[0]));
      events.push(`lock:${String(values[0])}`);
      void strings;
      return Promise.resolve([{ id: 'locked' }]);
    }),
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const c = campaigns[where.id];
        return c ? { ...c, deadline: null, collectingEntityId: 'partner-1' } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => campaigns[id]).map((id) => ({ id, ...campaigns[id] })),
      ),
    },
    campaignTransfer: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'ct-new',
        createdAt: new Date(),
        ...data,
      })),
      findUnique: vi.fn().mockResolvedValue(state),
      findUniqueOrThrow: vi.fn().mockResolvedValue(state),
      updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
        if (!state || state.status !== where.status) return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      }),
    },
    donation: {
      findMany: vi.fn(async ({ where }: { where: { donorId?: unknown } }) =>
        where.donorId === null ? (options.guests ?? []) : (options.donors ?? []),
      ),
    },
    notification: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        events.push('notify');
        return { count: data.length };
      }),
    },
    ledgerEntry: {
      count: vi.fn(async () => 0),
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        events.push('post');
        rows.push(...data);
        return { count: data.length };
      }),
      groupBy: vi.fn(ledgerGroupBy(rows)),
    },
  };

  return { tx, state, rows, lockOrder, events, campaigns };
}

function makePrisma(tx: unknown, finalRow: Record<string, unknown> = transfer({ status: 'APPROVED' })) {
  return {
    $transaction: vi.fn((cb: (client: unknown) => unknown) => cb(tx)),
    campaignTransfer: { findUniqueOrThrow: vi.fn().mockResolvedValue(finalRow) },
  };
}

const REQUEST = {
  sourceId: SOURCE,
  targetId: TARGET,
  reason: 'Campaign asal disuspend',
  requestedById: 'admin-1',
};

describe('requestCampaignTransfer', () => {
  it('records a PENDING transfer and posts nothing: a request is not yet a movement of money', async () => {
    const { tx, rows } = makeTx();
    const before = rows.length;

    const recorded = await requestCampaignTransfer(tx as never, REQUEST);

    expect(recorded.status).toBe('PENDING');
    expect(tx.campaignTransfer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: SOURCE,
          targetId: TARGET,
          amount: 400_000,
          requestedById: 'admin-1',
          status: 'PENDING',
        }),
      }),
    );
    expect(rows.length).toBe(before);
  });

  it('refuses a source that is not Suspended', async () => {
    const { tx } = makeTx({ source: { lifecycleStatus: 'ACTIVE' } });
    await expect(requestCampaignTransfer(tx as never, REQUEST)).rejects.toBeInstanceOf(
      CampaignTransferSourceNotSuspendedError,
    );
    expect(tx.campaignTransfer.create).not.toHaveBeenCalled();
  });

  it('refuses a Suspended source of Kind Donation or Hibah: only zakat and wakaf are transferred', async () => {
    for (const kind of ['DONATION', 'HIBAH']) {
      const { tx } = makeTx({ source: { kind }, target: { kind } });
      await expect(requestCampaignTransfer(tx as never, REQUEST)).rejects.toBeInstanceOf(
        CampaignTransferKindNotTransferableError,
      );
    }
  });

  it.each([
    ['ZAKAT', 'WAKAF'],
    ['WAKAF', 'ZAKAT'],
    ['ZAKAT', 'DONATION'],
    ['WAKAF', 'HIBAH'],
    ['ZAKAT', 'HIBAH'],
  ])('refuses %s money going to a %s Campaign outright', async (sourceKind, targetKind) => {
    const { tx } = makeTx({ source: { kind: sourceKind }, target: { kind: targetKind } });
    await expect(requestCampaignTransfer(tx as never, REQUEST)).rejects.toBeInstanceOf(CampaignTransferCrossKindError);
    expect(tx.campaignTransfer.create).not.toHaveBeenCalled();
  });

  it('refuses wakaf money going to a wakaf Campaign of another category', async () => {
    const { tx } = makeTx({
      source: { kind: 'WAKAF', category: 'Wakaf Pendidikan' },
      target: { kind: 'WAKAF', category: 'Wakaf Kesehatan' },
    });
    await expect(requestCampaignTransfer(tx as never, REQUEST)).rejects.toBeInstanceOf(
      CampaignTransferCategoryMismatchError,
    );
  });

  it('allows wakaf to wakaf of the same category', async () => {
    const { tx } = makeTx({
      source: { kind: 'WAKAF', category: 'Wakaf Pendidikan' },
      target: { kind: 'WAKAF', category: 'Wakaf Pendidikan' },
    });
    await expect(requestCampaignTransfer(tx as never, REQUEST)).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('does not require a category match for zakat', async () => {
    const { tx } = makeTx({ source: { category: 'A' }, target: { category: 'B' } });
    await expect(requestCampaignTransfer(tx as never, REQUEST)).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('refuses the source itself, a Demo target and a target that is not Active', async () => {
    const same = makeTx();
    await expect(
      requestCampaignTransfer(same.tx as never, { ...REQUEST, targetId: SOURCE }),
    ).rejects.toMatchObject({ reason: 'same_campaign' });

    const demo = makeTx({ target: { isDemo: true } });
    await expect(requestCampaignTransfer(demo.tx as never, REQUEST)).rejects.toMatchObject({ reason: 'demo' });

    for (const lifecycleStatus of ['SUSPENDED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'DRAFT']) {
      const t = makeTx({ target: { lifecycleStatus } });
      await expect(requestCampaignTransfer(t.tx as never, REQUEST)).rejects.toBeInstanceOf(
        CampaignTransferTargetNotEligibleError,
      );
    }
  });

  it('refuses a Demo source', async () => {
    const { tx } = makeTx({ source: { isDemo: true } });
    await expect(requestCampaignTransfer(tx as never, REQUEST)).rejects.toBeInstanceOf(DemoCampaignError);
  });

  it('takes the whole withdrawable balance as the amount, ignoring any amount smuggled into the params', async () => {
    const { tx } = makeTx({
      sourceBalance: 750_000,
      extraRows: [
        { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 300_000 },
        { account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 120_000 },
      ],
    });
    const recorded = await requestCampaignTransfer(tx as never, { ...REQUEST, amount: 1 } as never);
    expect(recorded.amount).toBe(750_000);
  });

  it('refuses a source with no withdrawable balance, and a missing reason', async () => {
    const empty = makeTx({ sourceBalance: 0, extraRows: [{ account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 500_000 }] });
    await expect(requestCampaignTransfer(empty.tx as never, REQUEST)).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(empty.tx.campaignTransfer.create).not.toHaveBeenCalled();

    await expect(
      requestCampaignTransfer(makeTx().tx as never, { ...REQUEST, reason: '   ' }),
    ).rejects.toBeInstanceOf(CampaignTransferInvalidError);
  });

  it('allows a follow-up request after an APPROVED transfer from the same source', async () => {
    // Escrow Hold that matured since moves by a new transfer under the same rules.
    const { tx } = makeTx({ sourceBalance: 90_000 });
    await expect(requestCampaignTransfer(tx as never, REQUEST)).resolves.toMatchObject({
      status: 'PENDING',
      amount: 90_000,
    });
    // The request never looks at earlier transfers, so none can block it.
    expect(tx.campaignTransfer.findUnique).not.toHaveBeenCalled();
  });

  it('refuses an Admin who is the Fundraiser of either Campaign', async () => {
    const onSource = makeTx();
    await expect(
      requestCampaignTransfer(onSource.tx as never, { ...REQUEST, requestedById: 'fundraiser-x' }),
    ).rejects.toBeInstanceOf(OwnSubjectConflictError);
    const onTarget = makeTx();
    await expect(
      requestCampaignTransfer(onTarget.tx as never, { ...REQUEST, requestedById: 'fundraiser-y' }),
    ).rejects.toBeInstanceOf(OwnSubjectConflictError);
  });

  it('locks both Campaigns in id order whichever is the source', async () => {
    const { tx, lockOrder } = makeTx();
    await requestCampaignTransfer(tx as never, REQUEST);
    expect(lockOrder).toEqual([TARGET, SOURCE]);
  });
});

describe('approveCampaignTransfer', () => {
  it('posts one balanced journal: debit the source balance, credit the target, tagged with the transfer', async () => {
    const { tx, rows } = makeTx();
    const before = rows.length;

    await approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' });

    const posted = rows.slice(before);
    expect(posted).toHaveLength(2);
    const debits = posted.filter((r) => r.direction === 'DEBIT');
    const credits = posted.filter((r) => r.direction === 'CREDIT');
    expect(debits.reduce((n, r) => n + r.amount, 0)).toBe(400_000);
    expect(credits.reduce((n, r) => n + r.amount, 0)).toBe(400_000);
    expect(debits[0]).toMatchObject({ account: 'CAMPAIGN_BALANCE', campaignId: SOURCE, campaignTransferId: 'ct-1' });
    expect(credits[0]).toMatchObject({ account: 'CAMPAIGN_BALANCE', campaignId: TARGET, campaignTransferId: 'ct-1' });
    expect(new Set(posted.map((r) => r.transactionId)).size).toBe(1);
    expect(posted[0].transactionId).toBe('campaign-transfer-ct-1');
  });

  it('records the approver and never touches a stored balance column', async () => {
    const { tx, state } = makeTx();
    await approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' });
    expect(state).toMatchObject({ status: 'APPROVED', decidedById: 'admin-2' });
    expect((tx.campaign as Record<string, unknown>).update).toBeUndefined();
  });

  it('refuses the requester approving their own transfer, before any write', async () => {
    const { tx, rows, state } = makeTx();
    const before = rows.length;
    await expect(
      approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-1' }),
    ).rejects.toBeInstanceOf(SelfApprovalError);
    expect(rows.length).toBe(before);
    expect(state?.status).toBe('PENDING');
  });

  it('locks both Campaigns in id order, before it reads the balance or writes anything', async () => {
    const { tx, lockOrder, events } = makeTx();
    await approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' });
    expect(lockOrder).toEqual([TARGET, SOURCE]);
    expect(events.indexOf(`lock:${SOURCE}`)).toBeLessThan(events.indexOf('post'));
  });

  it('re-judges under the lock: a Suspension lifted since the request stops the money', async () => {
    const { tx, rows } = makeTx({ source: { lifecycleStatus: 'ACTIVE' } });
    const before = rows.length;
    await expect(
      approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
    ).rejects.toBeInstanceOf(CampaignTransferSourceNotSuspendedError);
    expect(rows.length).toBe(before);
  });

  it('refuses when the balance changed since the request, whichever way: full transfer only, nothing moves', async () => {
    for (const sourceBalance of [100_000, 900_000]) {
      const { tx, rows, state } = makeTx({ sourceBalance });
      const before = rows.length;
      await expect(
        approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
      ).rejects.toBeInstanceOf(CampaignTransferBalanceChangedError);
      expect(rows.length).toBe(before);
      expect(state?.status).toBe('PENDING');
    }
  });

  it('refuses an approval when the source was drained to nothing since the request', async () => {
    const { tx, rows } = makeTx({ sourceBalance: 0 });
    const before = rows.length;
    await expect(
      approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(rows.length).toBe(before);
  });

  it('approves a follow-up transfer although an earlier one from the same source is already APPROVED', async () => {
    // The first transfer drained the source; Escrow Hold then matured (80k) and a second, full request captured it.
    const { tx, rows } = makeTx({
      sourceBalance: 400_000,
      row: transfer({ id: 'ct-2', amount: 80_000 }),
      extraRows: [
        { account: 'CAMPAIGN_BALANCE', direction: 'DEBIT', amount: 400_000 },
        { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 80_000 },
      ],
    });
    const before = rows.length;
    await approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-2', decidedById: 'admin-2' });
    const posted = rows.slice(before);
    expect(posted.reduce((n, r) => n + (r.direction === 'DEBIT' ? r.amount : 0), 0)).toBe(80_000);
  });

  it('re-judges the Kinds even if the stored row somehow names mismatched Campaigns', async () => {
    const { tx, rows } = makeTx({ target: { kind: 'WAKAF' } });
    const before = rows.length;
    await expect(
      approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
    ).rejects.toBeInstanceOf(CampaignTransferCrossKindError);
    expect(rows.length).toBe(before);
  });

  it('moves only the withdrawable balance: Escrow Hold and money frozen for a Refund stay with the source', async () => {
    const { tx, rows } = makeTx({
      sourceBalance: 1_000_000,
      row: transfer({ amount: 1_000_000 }),
      extraRows: [
        { account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 300_000 },
        { account: 'FROZEN_BALANCE', direction: 'CREDIT', amount: 120_000 },
      ],
    });
    const net = (account: string, campaignId: string) =>
      rows
        .filter((r) => r.account === account && r.campaignId === campaignId)
        .reduce((n, r) => n + (r.direction === 'CREDIT' ? r.amount : -r.amount), 0);

    await approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' });

    expect(net('CAMPAIGN_BALANCE', SOURCE)).toBe(0);
    expect(net('CAMPAIGN_BALANCE', TARGET)).toBe(1_000_000);
    expect(net('ESCROW_HOLD', SOURCE)).toBe(300_000);
    expect(net('FROZEN_BALANCE', SOURCE)).toBe(120_000);
    expect(net('ESCROW_HOLD', TARGET)).toBe(0);
    expect(net('FROZEN_BALANCE', TARGET)).toBe(0);
    // The transfer's own journal touches CAMPAIGN_BALANCE and nothing else.
    expect(rows.filter((r) => r.campaignTransferId === 'ct-1').map((r) => r.account)).toEqual([
      'CAMPAIGN_BALANCE',
      'CAMPAIGN_BALANCE',
    ]);
  });

  it('does not count Escrow Hold towards what may be transferred', async () => {
    const { tx } = makeTx({
      sourceBalance: 100_000,
      row: transfer({ amount: 1_000_000 }),
      extraRows: [{ account: 'ESCROW_HOLD', direction: 'CREDIT', amount: 900_000 }],
    });
    await expect(
      approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
    ).rejects.toBeInstanceOf(CampaignTransferBalanceChangedError);
  });

  it('a Kind changed after the request stops the approval; the real edit rules would not allow one past Draft', async () => {
    // The real flow first: once a Campaign has left Draft, no edit changes its Kind.
    const activeState = { kind: 'campaign', effectiveStatus: 'ACTIVE', campaignKind: 'ZAKAT', deadline: null } as never;
    expect(() => requireKindAndDeadlineEditable(activeState, { kind: 'WAKAF' })).toThrow(KindImmutableError);

    // Defence in depth: were it changed anyway, approval re-judges and refuses.
    const { tx, rows, campaigns } = makeTx();
    campaigns[TARGET].kind = 'WAKAF';
    const before = rows.length;
    await expect(
      approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
    ).rejects.toBeInstanceOf(CampaignTransferCrossKindError);
    expect(rows.length).toBe(before);
  });

  it('a wakaf Category changed after the request stops the approval', async () => {
    const { tx, rows, campaigns } = makeTx({
      source: { kind: 'WAKAF', category: 'Wakaf Pendidikan' },
      target: { kind: 'WAKAF', category: 'Wakaf Pendidikan' },
    });
    campaigns[TARGET].category = 'Wakaf Kesehatan';
    const before = rows.length;
    await expect(
      approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
    ).rejects.toBeInstanceOf(CampaignTransferCategoryMismatchError);
    expect(rows.length).toBe(before);
  });

  it('refuses an Admin who is the Fundraiser of either Campaign', async () => {
    const { tx } = makeTx();
    await expect(
      approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'fundraiser-y' }),
    ).rejects.toBeInstanceOf(OwnSubjectConflictError);
  });

  it('refuses a missing transfer and one that is no longer PENDING', async () => {
    const missing = makeTx({ row: null });
    await expect(
      approveCampaignTransfer(makePrisma(missing.tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
    ).rejects.toBeInstanceOf(CampaignTransferNotFoundError);

    const decided = makeTx({ row: transfer({ status: 'APPROVED', decidedById: 'admin-9' }) });
    await expect(
      approveCampaignTransfer(makePrisma(decided.tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' }),
    ).rejects.toBeInstanceOf(CampaignTransferNotPendingError);
    expect(decided.rows.filter((r) => r.campaignTransferId)).toEqual([]);
  });

  it('is claimed once: a second approval posts nothing', async () => {
    const { tx, rows } = makeTx();
    const prisma = makePrisma(tx);
    await approveCampaignTransfer(prisma as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' });
    const after = rows.length;
    await expect(
      approveCampaignTransfer(prisma as never, { campaignTransferId: 'ct-1', decidedById: 'admin-3' }),
    ).rejects.toBeInstanceOf(CampaignTransferNotPendingError);
    expect(rows.length).toBe(after);
  });

  it('tells every registered Donor of the source where the money went, and both Fundraisers, in the same transaction', async () => {
    const { tx, events } = makeTx({ donors: [{ donorId: 'donor-1' }, { donorId: 'donor-2' }] });
    await approveCampaignTransfer(makePrisma(tx) as never, { campaignTransferId: 'ct-1', decidedById: 'admin-2' });

    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
    const { data } = tx.notification.createMany.mock.calls[0][0] as {
      data: Array<{ userId: string; message: string; type: string; link: string }>;
    };
    const byUser = new Map(data.map((n) => [n.userId, n]));
    expect([...byUser.keys()].sort()).toEqual(['donor-1', 'donor-2', 'fundraiser-x', 'fundraiser-y']);
    expect(byUser.get('donor-1')!.type).toBe('campaign_transfer');
    expect(byUser.get('donor-1')!.message).toContain('Zakat Sumber');
    expect(byUser.get('donor-1')!.message).toContain('Zakat Tujuan');
    expect(byUser.get('donor-1')!.link).toBe('/campaign/zakat-tujuan');
    expect(events.indexOf('post')).toBeLessThan(events.indexOf('notify'));
  });

  it('emails Guest Donors, who have no inbox, and skips an anonymised one', async () => {
    const { tx } = makeTx({
      guests: [
        { guestEmailCiphertext: 'c1', guestEmailKeyId: 'k1' },
        { guestEmailCiphertext: null, guestEmailKeyId: null },
      ],
    });
    const send = vi.fn().mockResolvedValue(undefined);
    await approveCampaignTransfer(
      makePrisma(tx) as never,
      { campaignTransferId: 'ct-1', decidedById: 'admin-2' },
      { mailer: { name: 'test', send }, readGuestEmail: (row) => (row.guestEmailCiphertext ? 'tamu@example.com' : null) },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'tamu@example.com' });
    expect(send.mock.calls[0][0].text).toContain('Zakat Tujuan');
  });

  it('a mail failure does not undo the committed transfer', async () => {
    const { tx, rows } = makeTx({ guests: [{ guestEmailCiphertext: 'c1', guestEmailKeyId: 'k1' }] });
    const send = vi.fn().mockRejectedValue(new Error('smtp down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      approveCampaignTransfer(
        makePrisma(tx) as never,
        { campaignTransferId: 'ct-1', decidedById: 'admin-2' },
        { mailer: { name: 'test', send }, readGuestEmail: () => 'tamu@example.com' },
      ),
    ).resolves.toBeDefined();
    expect(rows.some((r) => r.campaignTransferId === 'ct-1')).toBe(true);
    log.mockRestore();
  });
});

describe('rejectCampaignTransfer', () => {
  it('declines with a reason and posts nothing', async () => {
    const { tx, rows, state } = makeTx();
    const before = rows.length;
    await rejectCampaignTransfer(makePrisma(tx) as never, {
      campaignTransferId: 'ct-1',
      decidedById: 'admin-2',
      reason: 'Campaign tujuan belum diverifikasi',
    });
    expect(state).toMatchObject({ status: 'REJECTED', decidedById: 'admin-2', decisionReason: 'Campaign tujuan belum diverifikasi' });
    expect(rows.length).toBe(before);
  });

  it('applies the same two-person rule and requires a reason', async () => {
    const own = makeTx();
    await expect(
      rejectCampaignTransfer(makePrisma(own.tx) as never, {
        campaignTransferId: 'ct-1',
        decidedById: 'admin-1',
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(SelfApprovalError);

    const blank = makeTx();
    await expect(
      rejectCampaignTransfer(makePrisma(blank.tx) as never, {
        campaignTransferId: 'ct-1',
        decidedById: 'admin-2',
        reason: ' ',
      }),
    ).rejects.toBeInstanceOf(CampaignTransferInvalidError);
  });
});
