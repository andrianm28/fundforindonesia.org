import { describe, it, expect, vi } from 'vitest';
import {
  recordManualContribution,
  approveManualContribution,
  rejectManualContribution,
  reverseManualContribution,
  ManualContributionNotFoundError,
  ManualContributionTargetError,
  ManualContributionProofRequiredError,
  ManualContributionAmountError,
  ManualContributionInputError,
  ManualContributionNotPendingError,
  ManualContributionNotApprovedError,
  ManualContributionAlreadySpentError,
  SelfApprovalError,
  OwnSubjectConflictError,
} from './manual-contributions';

/**
 * Manual Contribution (prd-compliance 34; PRD FFI-07c; CONTEXT.md, Manual
 * Contribution): money that arrives outside the payment gateway.
 *
 * The behaviour these pin, in the order an Admin meets it:
 *
 *  - one Admin records it, with the proof of transfer, and it is NOT money yet;
 *  - a different Admin approves it, and only then does the money exist, on the
 *    withdrawable balance, with no Escrow Hold and neither fee;
 *  - a correction is an opposite journal, never a deletion, and only while the
 *    money is still there to take back.
 *
 * The two checks that are easy to leave out and expensive to discover late:
 * an Admin who is the Campaign's own Fundraiser is refused (otherwise a
 * fundraiser could credit their own Campaign and pay it straight out), and the
 * reversal is refused once a Payout has drawn the balance below the
 * contribution (otherwise the opposite journal drives the pool negative).
 */

type LedgerRow = {
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  account: string;
  campaignId: string | null;
  volunteerTripId: string | null;
  programId: string | null;
  manualContributionId: string | null;
};

const CAMPAIGN = { campaignId: 'campaign-1' } as const;
const PROGRAM = { programId: 'program-1' } as const;

/** A Manual Contribution row as the module reads it back. */
function contribution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mc-1',
    amount: 250_000,
    campaignId: 'campaign-1' as string | null,
    programId: null as string | null,
    proofReference: 'bukti-transfer.pdf',
    note: null as string | null,
    status: 'PENDING',
    recordedById: 'admin-1',
    decidedById: null as string | null,
    decidedAt: null as Date | null,
    decisionReason: null as string | null,
    reversedById: null as string | null,
    reversedAt: null as Date | null,
    createdAt: new Date('2026-09-01'),
    ...overrides,
  };
}

function makeTx(
  options: {
    row?: Record<string, unknown> | null;
    ledgerRows?: LedgerRow[];
    campaignCreatorId?: string;
    programExists?: boolean;
  } = {},
) {
  const rows: LedgerRow[] = (options.ledgerRows ?? []).map((r) => ({ ...r }));
  const state = options.row === undefined ? contribution() : options.row ? { ...options.row } : null;
  const queryRawCalls: string[] = [];
  let contributions = 0;

  const campaignUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
  const tx = {
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join('');
      queryRawCalls.push(text);
      return Promise.resolve([{ id: 'locked' }]);
    }),
    manualContribution: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        contributions += 1;
        return { id: `mc-new-${contributions}`, createdAt: new Date(), ...data };
      }),
      findUnique: vi.fn().mockResolvedValue(state),
      findUniqueOrThrow: vi.fn().mockResolvedValue(state),
      updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
        if (!state || state.status !== where.status) return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      }),
    },
    campaign: {
      findUnique: vi.fn().mockResolvedValue({
        creatorId: options.campaignCreatorId ?? 'fundraiser-1',
        isDemo: false,
        lifecycleStatus: 'ACTIVE',
        deadline: null,
        kind: 'DONATION',
        collectingEntityId: 'partner-1',
      }),
      update: campaignUpdate,
    },
    program: {
      findUnique: vi.fn().mockResolvedValue(
        options.programExists === false ? null : { id: 'program-1', title: 'Beasiswa Anak Pesisir' },
      ),
    },
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
  };

  return {
    tx,
    state,
    rows,
    queryRawCalls,
    campaignUpdate,
    contributionCreate: tx.manualContribution.create,
  };
}

function makePrisma(tx: unknown, finalRow: Record<string, unknown>) {
  return {
    $transaction: vi.fn((cb: (client: unknown) => unknown) => cb(tx)),
    manualContribution: { findUniqueOrThrow: vi.fn().mockResolvedValue(finalRow) },
  };
}

/** The rows of the one transaction the module posted, by account. */
function posted(rows: LedgerRow[], account: string) {
  return rows.filter((r) => r.account === account);
}

describe('recordManualContribution', () => {
  it('records a PENDING contribution and posts nothing -- recording is not yet a movement of money', async () => {
    const { tx, rows, contributionCreate } = makeTx();

    const recorded = await recordManualContribution(tx as never, {
      target: CAMPAIGN,
      amount: 250_000,
      proofReference: 'bukti-transfer.pdf',
      note: 'Transfer BCA olehAnonim',
      recordedById: 'admin-1',
    });

    expect(recorded.status).toBe('PENDING');
    expect(contributionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 250_000,
          campaignId: 'campaign-1',
          programId: null,
          proofReference: 'bukti-transfer.pdf',
          recordedById: 'admin-1',
          status: 'PENDING',
        }),
      }),
    );
    // Nothing is in the books until a second Admin says so, or the Campaign
    // Balance could be spent on a record nobody has agreed is real.
    expect(rows).toEqual([]);
  });

  it('names a Program instead of a Campaign when the contribution is CSR money', async () => {
    const { tx, contributionCreate } = makeTx();

    await recordManualContribution(tx as never, {
      target: PROGRAM,
      amount: 500_000_000,
      proofReference: 'invoice-yiem-2026.pdf',
      recordedById: 'admin-1',
    });

    expect(contributionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ campaignId: null, programId: 'program-1' }),
      }),
    );
  });

  it('refuses a target that is neither a Campaign nor a Program, or both at once', async () => {
    const { tx } = makeTx();

    // Neither: the money would belong to nobody.
    await expect(
      recordManualContribution(tx as never, {
        target: {},
        amount: 1_000,
        proofReference: 'bukti.pdf',
        recordedById: 'admin-1',
      }),
    ).rejects.toThrow(ManualContributionTargetError);
    // Both: a single amount cannot sit in two balances at once, and picking
    // one for the caller would be a coin toss on where the money lands.
    await expect(
      recordManualContribution(tx as never, {
        target: { campaignId: 'campaign-1', programId: 'program-1' },
        amount: 1_000,
        proofReference: 'bukti.pdf',
        recordedById: 'admin-1',
      }),
    ).rejects.toThrow(ManualContributionTargetError);
    // Blank is not a target either: '' is what an un-filled form field sends.
    await expect(
      recordManualContribution(tx as never, {
        target: { campaignId: '   ', programId: '' },
        amount: 1_000,
        proofReference: 'bukti.pdf',
        recordedById: 'admin-1',
      }),
    ).rejects.toThrow(ManualContributionTargetError);
  });

  it('refuses a contribution with no proof of transfer', async () => {
    // The whole two-person rule is a check on evidence; a record without any
    // is a number somebody typed.
    for (const proofReference of ['', '   ', undefined as unknown as string]) {
      const { tx, rows } = makeTx();
      await expect(
        recordManualContribution(tx as never, {
          target: CAMPAIGN,
          amount: 1_000,
          proofReference,
          recordedById: 'admin-1',
        }),
      ).rejects.toThrow(ManualContributionProofRequiredError);
      expect(rows).toEqual([]);
    }
  });

  it('refuses an amount that is not whole rupiah above zero', async () => {
    const { tx } = makeTx();
    for (const amount of [0, -5_000, 1_000.5, Number.NaN]) {
      await expect(
        recordManualContribution(tx as never, {
          target: CAMPAIGN,
          amount,
          proofReference: 'bukti.pdf',
          recordedById: 'admin-1',
        }),
      ).rejects.toThrow(ManualContributionAmountError);
    }
  });

  it('refuses a Volunteer Trip as the target, however it is spelled', async () => {
    // A Trip Fee is money a Volunteer pays for their own seat and has its own
    // Payout path. Money recorded off-gateway must not be able to top one up.
    const { tx } = makeTx();

    await expect(
      recordManualContribution(tx as never, {
        target: { volunteerTripId: 'trip-1' } as never,
        amount: 1_000,
        proofReference: 'bukti.pdf',
        recordedById: 'admin-1',
      }),
    ).rejects.toThrow(ManualContributionTargetError);
  });

  it('refuses a target that does not exist, rather than crediting money to nobody', async () => {
    const { tx } = makeTx({ programExists: false });

    await expect(
      recordManualContribution(tx as never, {
        target: PROGRAM,
        amount: 1_000,
        proofReference: 'bukti.pdf',
        recordedById: 'admin-1',
      }),
    ).rejects.toThrow(ManualContributionNotFoundError);
  });

  it('refuses an Admin who is the Campaign Fundraiser from recording money into their own Campaign', async () => {
    // A fundraiser with the ADMIN assignment could otherwise credit their own
    // Campaign and pay it straight back out through a Payout.
    const { tx, rows } = makeTx({ campaignCreatorId: 'admin-1' });

    await expect(
      recordManualContribution(tx as never, {
        target: CAMPAIGN,
        amount: 1_000,
        proofReference: 'bukti.pdf',
        recordedById: 'admin-1',
      }),
    ).rejects.toThrow(OwnSubjectConflictError);
    expect(rows).toEqual([]);
  });

  it('lets the same Admin record CSR money against a Program, which has no Fundraiser', async () => {
    const { tx } = makeTx({ campaignCreatorId: 'admin-1' });

    await expect(
      recordManualContribution(tx as never, {
        target: PROGRAM,
        amount: 1_000,
        proofReference: 'bukti.pdf',
        recordedById: 'admin-1',
      }),
    ).resolves.toBeTruthy();
  });
});

describe('approveManualContribution', () => {
  it('credits the Campaign Balance with the whole amount -- no Escrow Hold, and neither fee', async () => {
    const { tx, rows } = makeTx();

    await approveManualContribution(makePrisma(tx, contribution({ status: 'APPROVED' })) as never, {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
    });

    // 250 000 in, 250 000 out the other side: no fee is taken off money that
    // never went through a provider, and nothing is held back for seven days.
    expect(posted(rows, 'CAMPAIGN_BALANCE')).toEqual([
      expect.objectContaining({ direction: 'CREDIT', amount: 250_000, campaignId: 'campaign-1' }),
    ]);
    expect(posted(rows, 'MANUAL_INTAKE_CLEARING')).toEqual([
      expect.objectContaining({ direction: 'DEBIT', amount: 250_000, campaignId: null }),
    ]);
    expect(posted(rows, 'ESCROW_HOLD')).toEqual([]);
    expect(posted(rows, 'PLATFORM_FEE')).toEqual([]);
    expect(posted(rows, 'PROVIDER_FEE')).toEqual([]);
  });

  it('credits PROGRAM_BALANCE, never CAMPAIGN_BALANCE, when it names a Program', async () => {
    const { tx, rows } = makeTx({ row: contribution({ campaignId: null, programId: 'program-1' }) });

    await approveManualContribution(makePrisma(tx, contribution({ status: 'APPROVED' })) as never, {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
    });

    expect(posted(rows, 'PROGRAM_BALANCE')).toEqual([
      expect.objectContaining({ direction: 'CREDIT', amount: 250_000, programId: 'program-1' }),
    ]);
    expect(posted(rows, 'CAMPAIGN_BALANCE')).toEqual([]);
  });

  it('attributes every entry to the contribution, so a reader can tell it apart from a Payment', async () => {
    const { tx, rows } = makeTx();

    await approveManualContribution(makePrisma(tx, contribution({ status: 'APPROVED' })) as never, {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
    });

    expect(rows.every((r) => r.manualContributionId === 'mc-1')).toBe(true);
    expect(new Set(rows.map((r) => r.transactionId)).size).toBe(1);
  });

  it('adds the amount to the collected figure of a Campaign, in the same transaction as the ledger', async () => {
    const { tx, campaignUpdate } = makeTx();

    await approveManualContribution(makePrisma(tx, contribution({ status: 'APPROVED' })) as never, {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
    });

    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { collectedAmount: { increment: 250_000 } },
    });
  });

  it('leaves a Program out of any Campaign collected figure, because a Program has none', async () => {
    const { tx, campaignUpdate } = makeTx({ row: contribution({ campaignId: null, programId: 'program-1' }) });

    await approveManualContribution(makePrisma(tx, contribution({ status: 'APPROVED' })) as never, {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
    });

    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it('refuses the Admin who recorded it, and writes nothing at all', async () => {
    const { tx, rows, state } = makeTx();

    await expect(
      approveManualContribution(makePrisma(tx, contribution()) as never, {
        manualContributionId: 'mc-1',
        decidedById: 'admin-1',
      }),
    ).rejects.toThrow(SelfApprovalError);

    expect(rows).toEqual([]);
    expect(state?.status).toBe('PENDING');
  });

  it('refuses a second approval of a contribution someone else already approved', async () => {
    const { tx, rows } = makeTx({ row: contribution({ status: 'APPROVED', decidedById: 'admin-2' }) });

    await expect(
      approveManualContribution(makePrisma(tx, contribution({ status: 'APPROVED' })) as never, {
        manualContributionId: 'mc-1',
        decidedById: 'admin-3',
      }),
    ).rejects.toThrow(ManualContributionNotPendingError);
    expect(rows).toEqual([]);
  });

  it('refuses a contribution that does not exist', async () => {
    const { tx, rows } = makeTx({ row: null });

    await expect(
      approveManualContribution(makePrisma(tx, {}) as never, {
        manualContributionId: 'mc-missing',
        decidedById: 'admin-2',
      }),
    ).rejects.toThrow(ManualContributionNotFoundError);
    expect(rows).toEqual([]);
  });

  it('refuses an Admin who is the Campaign Fundraiser, on approval as much as on recording', async () => {
    // Recording is refused too, so this can only be reached by a contribution
    // another Admin recorded -- the check still has to be here, because the
    // Fundraiser may have become one, or the two-person pair may be the
    // campaign's own creator and a colleague.
    const { tx, rows } = makeTx({ campaignCreatorId: 'admin-2' });

    await expect(
      approveManualContribution(makePrisma(tx, contribution()) as never, {
        manualContributionId: 'mc-1',
        decidedById: 'admin-2',
      }),
    ).rejects.toThrow(OwnSubjectConflictError);
    expect(rows).toEqual([]);
  });

  it('locks the Campaign row before reading the balance, so a Payout cannot drain it mid-approval', async () => {
    const { tx, queryRawCalls } = makeTx();

    await approveManualContribution(makePrisma(tx, contribution({ status: 'APPROVED' })) as never, {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
    });

    expect(queryRawCalls.some((sql) => sql.includes('"Campaign"') && sql.includes('FOR UPDATE'))).toBe(true);
  });

  it('locks the Program row too, so two concurrent reversals cannot over-draw one Program', async () => {
    const { tx, queryRawCalls } = makeTx({ row: contribution({ campaignId: null, programId: 'program-1' }) });

    await approveManualContribution(makePrisma(tx, contribution({ status: 'APPROVED' })) as never, {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
    });

    expect(queryRawCalls.some((sql) => sql.includes('"Program"') && sql.includes('FOR UPDATE'))).toBe(true);
  });

  it('loses the race to a concurrent approval without posting a second time', async () => {
    // The claim is a predicated updateMany on the status, so a second
    // approval reading the same PENDING row cannot both claim it.
    const { tx, rows, state } = makeTx();
    state!.status = 'APPROVED';

    await expect(
      approveManualContribution(makePrisma(tx, contribution()) as never, {
        manualContributionId: 'mc-1',
        decidedById: 'admin-2',
      }),
    ).rejects.toThrow(ManualContributionNotPendingError);
    expect(rows).toEqual([]);
  });
});

describe('rejectManualContribution', () => {
  it('closes the record with a reason and posts nothing, because no money ever moved', async () => {
    const { tx, rows, state } = makeTx();

    await rejectManualContribution(makePrisma(tx, contribution({ status: 'REJECTED' })) as never, {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
      reason: 'Bukti transfer bukan untuk Campaign ini',
    });

    expect(rows).toEqual([]);
    expect(state).toMatchObject({
      status: 'REJECTED',
      decidedById: 'admin-2',
      decisionReason: 'Bukti transfer bukan untuk Campaign ini',
    });
  });

  it('refuses the Admin who recorded it, and refuses a record that was already decided', async () => {
    const selfDecided = makeTx();
    await expect(
      rejectManualContribution(makePrisma(selfDecided.tx, {}) as never, {
        manualContributionId: 'mc-1',
        decidedById: 'admin-1',
        reason: 'tidak jelas',
      }),
    ).rejects.toThrow(SelfApprovalError);
    expect(selfDecided.rows).toEqual([]);

    const alreadyDecided = makeTx({ row: contribution({ status: 'REJECTED', decidedById: 'admin-2' }) });
    await expect(
      rejectManualContribution(makePrisma(alreadyDecided.tx, {}) as never, {
        manualContributionId: 'mc-1',
        decidedById: 'admin-3',
        reason: 'tidak jelas',
      }),
    ).rejects.toThrow(ManualContributionNotPendingError);
  });

  it('needs a reason: a refusal with no explanation teaches nobody anything', async () => {
    const { tx, state } = makeTx();

    await expect(
      rejectManualContribution(makePrisma(tx, {}) as never, {
        manualContributionId: 'mc-1',
        decidedById: 'admin-2',
        reason: '   ',
      }),
    ).rejects.toThrow(ManualContributionInputError);
    expect(state?.status).toBe('PENDING');
  });

  it('refuses a note that is not text, with its own code rather than the target one', async () => {
    // A mistyped note is a different mistake from naming two targets, and a
    // client fixing one should not be sent hunting for the other.
    const { tx } = makeTx();

    await expect(
      recordManualContribution(tx as never, {
        target: CAMPAIGN,
        amount: 1_000,
        proofReference: 'bukti.pdf',
        note: 42 as never,
        recordedById: 'admin-1',
      }),
    ).rejects.toThrow(ManualContributionInputError);
  });
});

describe('reverseManualContribution', () => {
  /** An APPROVED Campaign contribution, with a balance left in the pool. */
  function approved(options: { ledgerRows?: LedgerRow[] } = {}) {
    return makeTx({
      row: contribution({ status: 'APPROVED', decidedById: 'admin-2' }),
      ledgerRows: [
        {
          transactionId: 'manual-contribution-mc-1',
          direction: 'CREDIT',
          amount: 250_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          volunteerTripId: null,
          programId: null,
          manualContributionId: 'mc-1',
        },
      ],
      ...options,
    });
  }

  it('takes the money back out with the mirror-image journal, and leaves the original rows alone', async () => {
    const { tx, rows, state } = approved();

    await reverseManualContribution(makePrisma(tx, contribution({ status: 'REVERSED' })) as never, {
      manualContributionId: 'mc-1',
      reversedById: 'admin-3',
      reason: 'Salah rekening tujuan',
    });

    expect(posted(rows, 'CAMPAIGN_BALANCE')).toEqual([
      expect.objectContaining({ direction: 'CREDIT', amount: 250_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ direction: 'DEBIT', amount: 250_000, campaignId: 'campaign-1' }),
    ]);
    // The reversal is a NEW transaction, not an edit: the original credit is
    // still there to be read, which is the point of an append-only ledger.
    expect(new Set(rows.map((r) => r.transactionId)).size).toBe(2);
    expect(state).toMatchObject({ status: 'REVERSED', reversedById: 'admin-3' });
  });

  it('removes the amount from the Campaign collected figure in the same transaction', async () => {
    const { tx, campaignUpdate } = approved();

    await reverseManualContribution(makePrisma(tx, contribution({ status: 'REVERSED' })) as never, {
      manualContributionId: 'mc-1',
      reversedById: 'admin-3',
      reason: 'Salah rekening tujuan',
    });

    expect(campaignUpdate).toHaveBeenCalledWith({
      where: { id: 'campaign-1' },
      data: { collectedAmount: { decrement: 250_000 } },
    });
  });

  it('leaves a Program collected figure alone, because a Program has none', async () => {
    const { tx, campaignUpdate, rows } = makeTx({
      row: contribution({ campaignId: null, programId: 'program-1', status: 'APPROVED', decidedById: 'admin-2' }),
      ledgerRows: [
        {
          transactionId: 'manual-contribution-mc-1',
          direction: 'CREDIT',
          amount: 250_000,
          account: 'PROGRAM_BALANCE',
          campaignId: null,
          volunteerTripId: null,
          programId: 'program-1',
          manualContributionId: 'mc-1',
        },
      ],
    });

    await reverseManualContribution(makePrisma(tx, contribution({ status: 'REVERSED' })) as never, {
      manualContributionId: 'mc-1',
      reversedById: 'admin-3',
      reason: 'Salah rekening tujuan',
    });

    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(posted(rows, 'PROGRAM_BALANCE')).toContainEqual(
      expect.objectContaining({ direction: 'DEBIT', amount: 250_000, programId: 'program-1' }),
    );
  });

  it('refuses once a Payout has drawn the balance below what is being taken back', async () => {
    // A Payout spent 200 000 of the 250 000. Writing the opposite journal
    // anyway would leave CAMPAIGN_BALANCE at -200 000: a campaign able to
    // withdraw money that left the platform a week ago.
    const { tx, rows, state } = approved({
      ledgerRows: [
        {
          transactionId: 'manual-contribution-mc-1',
          direction: 'CREDIT',
          amount: 250_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          volunteerTripId: null,
          programId: null,
          manualContributionId: 'mc-1',
        },
        {
          transactionId: 'payout-instructed-payout-1',
          direction: 'DEBIT',
          amount: 200_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          volunteerTripId: null,
          programId: null,
          manualContributionId: null,
        },
      ],
    });

    await expect(
      reverseManualContribution(makePrisma(tx, {}) as never, {
        manualContributionId: 'mc-1',
        reversedById: 'admin-3',
        reason: 'Salah rekening tujuan',
      }),
    ).rejects.toThrow(ManualContributionAlreadySpentError);
    expect(rows).toHaveLength(2);
    expect(state?.status).toBe('APPROVED');
  });

  it('reverses when the balance still covers the amount exactly, Payout or not', async () => {
    // 250 000 in, 100 000 of OTHER money released from escrow, 100 000 paid
    // out: the pool is back to 250 000, so the contribution can be taken out
    // whole without going negative. Which rupiah the Payout spent is not
    // something the ledger records -- the rule is the balance, not a guess
    // about provenance.
    const { tx, rows, state } = approved({
      ledgerRows: [
        {
          transactionId: 'manual-contribution-mc-1',
          direction: 'CREDIT',
          amount: 250_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          volunteerTripId: null,
          programId: null,
          manualContributionId: 'mc-1',
        },
        {
          transactionId: 'escrow-release-payment-1',
          direction: 'CREDIT',
          amount: 100_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          volunteerTripId: null,
          programId: null,
          manualContributionId: null,
        },
        {
          transactionId: 'payout-instructed-payout-1',
          direction: 'DEBIT',
          amount: 100_000,
          account: 'CAMPAIGN_BALANCE',
          campaignId: 'campaign-1',
          volunteerTripId: null,
          programId: null,
          manualContributionId: null,
        },
      ],
    });

    await reverseManualContribution(makePrisma(tx, contribution({ status: 'REVERSED' })) as never, {
      manualContributionId: 'mc-1',
      reversedById: 'admin-3',
      reason: 'Salah rekening tujuan',
    });

    expect(posted(rows, 'CAMPAIGN_BALANCE')).toContainEqual(
      expect.objectContaining({ direction: 'DEBIT', amount: 250_000 }),
    );
    expect(state?.status).toBe('REVERSED');
  });

  it('refuses a contribution that was never approved, or has already been reversed', async () => {
    // A PENDING one never entered the books, so there is nothing to take
    // back -- rejecting it is the way to close it.
    const pending = makeTx();
    await expect(
      reverseManualContribution(makePrisma(pending.tx, {}) as never, {
        manualContributionId: 'mc-1',
        reversedById: 'admin-3',
        reason: 'Salah rekening tujuan',
      }),
    ).rejects.toThrow(ManualContributionNotApprovedError);
    expect(pending.rows).toEqual([]);

    const alreadyReversed = makeTx({
      row: contribution({ status: 'REVERSED', decidedById: 'admin-2', reversedById: 'admin-3' }),
    });
    await expect(
      reverseManualContribution(makePrisma(alreadyReversed.tx, {}) as never, {
        manualContributionId: 'mc-1',
        reversedById: 'admin-4',
        reason: 'Salah rekening tujuan',
      }),
    ).rejects.toThrow(ManualContributionNotApprovedError);
    expect(alreadyReversed.rows).toEqual([]);
  });

  it('refuses an Admin who is the Campaign Fundraiser, who could otherwise drain their own Campaign', async () => {
    const { tx, rows } = approved();

    await expect(
      reverseManualContribution(makePrisma(tx, {}) as never, {
        manualContributionId: 'mc-1',
        reversedById: 'fundraiser-1',
        reason: 'Salah rekening tujuan',
      }),
    ).rejects.toThrow(OwnSubjectConflictError);
    expect(rows).toHaveLength(1);
  });

  it('never deletes the record: no statement in this module removes one', async () => {
    // The guarantee is structural. A reversal that dropped the row would
    // leave no evidence the money had ever been recorded.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'money', 'manual-contributions.ts'), 'utf8');

    expect(source).not.toMatch(/manualContribution\.(delete|deleteMany)\b/);
    // And the ledger rows this module's commands post are only ever added to:
    // postTransaction creates, nothing rewrites one.
    expect(source).not.toMatch(/ledgerEntry\.(delete|deleteMany|update|updateMany)\b/);
  });
});
