import { describe, it, expect, vi } from 'vitest';
import { submitUsageReport, disputeUsageReport, campaignBlockingUsageReport } from './usage-reports';
import { PayoutNotFoundError } from '@/lib/money/errors';
import {
  UsageReportAlreadyDisputedError,
  UsageReportAlreadyExistsError,
  UsageReportInvalidError,
  UsageReportNotFoundError,
  UsageReportPayoutNotCompletedError,
} from './usage-report-errors';
import { OwnSubjectConflictError } from '@/lib/capacity';

/**
 * Usage Report (ticket 22; PRD FFI-07a; CONTEXT.md, Usage Report): a
 * Fundraiser's account of one Payout's money, public the moment it is sent,
 * and an Admin's one-way "dipertanyakan" marker on it.
 */

function payoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    campaignId: 'campaign-1',
    volunteerTripId: null,
    amount: 300_000,
    status: 'COMPLETED',
    usageReport: null as Record<string, unknown> | null,
    ...overrides,
  };
}

function usageReportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ur-1',
    payoutId: 'payout-1',
    disputedAt: null as Date | null,
    payout: { campaignId: 'campaign-1', volunteerTripId: null },
    ...overrides,
  };
}

function makeSubmitTx(payout: Record<string, unknown> | null) {
  const usageReportCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'ur-1',
    createdAt: new Date(),
    ...data,
  }));
  const tx = {
    payout: { findUnique: vi.fn().mockResolvedValue(payout) },
    usageReport: { create: usageReportCreate },
  };
  const prisma = { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
  return { prisma, tx, usageReportCreate };
}

const VALID_LINE_ITEMS = [
  { label: 'Sembako', amount: 200_000 },
  { label: 'Transportasi', amount: 100_000 },
];

const VALID_SUBMIT_PARAMS = {
  payoutId: 'payout-1',
  submittedById: 'fundraiser-1',
  narrative: 'Dana dipakai untuk sembako dan transportasi ke lokasi.',
  lineItems: VALID_LINE_ITEMS,
  beneficiaryCount: 50,
  photos: ['https://example.com/bukti.jpg'],
};

describe('submitUsageReport', () => {
  it('creates a Usage Report for a COMPLETED Payout whose line items sum exactly to its amount', async () => {
    const { prisma, usageReportCreate } = makeSubmitTx(payoutRow());

    const report = await submitUsageReport(prisma as never, VALID_SUBMIT_PARAMS);

    expect(report.id).toBe('ur-1');
    expect(usageReportCreate).toHaveBeenCalledWith({
      data: {
        payoutId: 'payout-1',
        narrative: VALID_SUBMIT_PARAMS.narrative,
        lineItems: VALID_LINE_ITEMS,
        beneficiaryCount: 50,
        photos: ['https://example.com/bukti.jpg'],
        submittedById: 'fundraiser-1',
      },
    });
  });

  it('trims the narrative and each line item label before storing', async () => {
    const { prisma, usageReportCreate } = makeSubmitTx(payoutRow());

    await submitUsageReport(prisma as never, {
      ...VALID_SUBMIT_PARAMS,
      narrative: '  Dana dipakai untuk sembako.  ',
      lineItems: [{ label: '  Sembako  ', amount: 300_000 }],
    });

    expect(usageReportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          narrative: 'Dana dipakai untuk sembako.',
          lineItems: [{ label: 'Sembako', amount: 300_000 }],
        }),
      }),
    );
  });

  it('throws PayoutNotFoundError for a Payout that does not exist', async () => {
    const { prisma } = makeSubmitTx(null);

    await expect(submitUsageReport(prisma as never, VALID_SUBMIT_PARAMS)).rejects.toBeInstanceOf(
      PayoutNotFoundError,
    );
  });

  it.each(['DRAFT', 'APPROVED'] as const)(
    'refuses a %s Payout with UsageReportPayoutNotCompletedError',
    async (status) => {
      const { prisma } = makeSubmitTx(payoutRow({ status }));

      await expect(submitUsageReport(prisma as never, VALID_SUBMIT_PARAMS)).rejects.toBeInstanceOf(
        UsageReportPayoutNotCompletedError,
      );
    },
  );

  it('refuses a second Usage Report for the same Payout with UsageReportAlreadyExistsError', async () => {
    const { prisma } = makeSubmitTx(payoutRow({ usageReport: usageReportRow() }));

    await expect(submitUsageReport(prisma as never, VALID_SUBMIT_PARAMS)).rejects.toBeInstanceOf(
      UsageReportAlreadyExistsError,
    );
  });

  it('refuses a blank narrative without reading the Payout at all', async () => {
    const { prisma, tx } = makeSubmitTx(payoutRow());

    await expect(
      submitUsageReport(prisma as never, { ...VALID_SUBMIT_PARAMS, narrative: '   ' }),
    ).rejects.toBeInstanceOf(UsageReportInvalidError);
    expect(tx.payout.findUnique).not.toHaveBeenCalled();
  });

  it('refuses zero photos -- "minimal satu foto bukti"', async () => {
    const { prisma } = makeSubmitTx(payoutRow());

    await expect(
      submitUsageReport(prisma as never, { ...VALID_SUBMIT_PARAMS, photos: [] }),
    ).rejects.toBeInstanceOf(UsageReportInvalidError);
  });

  it.each([0, -1, 1.5])('refuses a beneficiaryCount of %s', async (beneficiaryCount) => {
    const { prisma } = makeSubmitTx(payoutRow());

    await expect(
      submitUsageReport(prisma as never, { ...VALID_SUBMIT_PARAMS, beneficiaryCount }),
    ).rejects.toBeInstanceOf(UsageReportInvalidError);
  });

  it('refuses line items whose total is less than the Payout amount', async () => {
    const { prisma } = makeSubmitTx(payoutRow({ amount: 300_000 }));

    await expect(
      submitUsageReport(prisma as never, {
        ...VALID_SUBMIT_PARAMS,
        lineItems: [{ label: 'Sembako', amount: 200_000 }],
      }),
    ).rejects.toBeInstanceOf(UsageReportInvalidError);
  });

  it('refuses line items whose total is more than the Payout amount', async () => {
    const { prisma } = makeSubmitTx(payoutRow({ amount: 300_000 }));

    await expect(
      submitUsageReport(prisma as never, {
        ...VALID_SUBMIT_PARAMS,
        lineItems: [{ label: 'Sembako', amount: 400_000 }],
      }),
    ).rejects.toBeInstanceOf(UsageReportInvalidError);
  });

  it('refuses a line item with a non-positive amount', async () => {
    const { prisma } = makeSubmitTx(payoutRow({ amount: 300_000 }));

    await expect(
      submitUsageReport(prisma as never, {
        ...VALID_SUBMIT_PARAMS,
        lineItems: [{ label: 'Sembako', amount: 0 }, { label: 'Sisa', amount: 300_000 }],
      }),
    ).rejects.toBeInstanceOf(UsageReportInvalidError);
  });

  it('refuses an empty lineItems array', async () => {
    const { prisma } = makeSubmitTx(payoutRow());

    await expect(
      submitUsageReport(prisma as never, { ...VALID_SUBMIT_PARAMS, lineItems: [] }),
    ).rejects.toBeInstanceOf(UsageReportInvalidError);
  });
});

function makeDisputeTx(report: Record<string, unknown> | null, campaignOwnerId = 'fundraiser-1') {
  const usageReportUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...report,
    ...data,
  }));
  const tx = {
    usageReport: { findUnique: vi.fn().mockResolvedValue(report), update: usageReportUpdate },
    campaign: {
      findUnique: vi.fn().mockResolvedValue({
        creatorId: campaignOwnerId,
        isDemo: false,
        lifecycleStatus: 'ACTIVE',
        deadline: null,
        kind: 'DONATION',
        collectingEntityId: null,
      }),
    },
    volunteerTrip: { findUnique: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
  };
  const prisma = { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
  return { prisma, tx, usageReportUpdate };
}

describe('disputeUsageReport', () => {
  it('marks the report disputed with the reason and the deciding Admin, for an Admin who does not own the Campaign', async () => {
    const { prisma, usageReportUpdate } = makeDisputeTx(usageReportRow());

    await disputeUsageReport(prisma as never, {
      usageReportId: 'ur-1',
      disputedById: 'admin-1',
      reason: '  Foto tidak sesuai narasi.  ',
    });

    expect(usageReportUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ur-1' },
        data: expect.objectContaining({
          disputedReason: 'Foto tidak sesuai narasi.',
          disputedById: 'admin-1',
        }),
      }),
    );
  });

  it('throws UsageReportNotFoundError for an id that does not exist', async () => {
    const { prisma } = makeDisputeTx(null);

    await expect(
      disputeUsageReport(prisma as never, { usageReportId: 'missing', disputedById: 'admin-1', reason: 'x' }),
    ).rejects.toBeInstanceOf(UsageReportNotFoundError);
  });

  it('refuses a second dispute: there is no code path that lifts one', async () => {
    const { prisma } = makeDisputeTx(usageReportRow({ disputedAt: new Date('2026-01-01') }));

    await expect(
      disputeUsageReport(prisma as never, { usageReportId: 'ur-1', disputedById: 'admin-1', reason: 'x' }),
    ).rejects.toBeInstanceOf(UsageReportAlreadyDisputedError);
  });

  it('refuses a blank reason without reading the report', async () => {
    const { prisma, tx } = makeDisputeTx(usageReportRow());

    await expect(
      disputeUsageReport(prisma as never, { usageReportId: 'ur-1', disputedById: 'admin-1', reason: '   ' }),
    ).rejects.toBeInstanceOf(UsageReportInvalidError);
    expect(tx.usageReport.findUnique).not.toHaveBeenCalled();
  });

  it("refuses the Campaign's own Fundraiser acting as Admin (CONTEXT.md, Admin)", async () => {
    const { prisma } = makeDisputeTx(usageReportRow(), 'fundraiser-1');

    await expect(
      disputeUsageReport(prisma as never, { usageReportId: 'ur-1', disputedById: 'fundraiser-1', reason: 'x' }),
    ).rejects.toBeInstanceOf(OwnSubjectConflictError);
  });
});

describe('campaignBlockingUsageReport', () => {
  it('asks for the oldest COMPLETED Payout on the Campaign with no Usage Report or a disputed one', async () => {
    const payoutFindFirst = vi.fn().mockResolvedValue(null);
    const tx = { payout: { findFirst: payoutFindFirst } };

    const result = await campaignBlockingUsageReport(tx as never, 'campaign-1');

    expect(result).toBeNull();
    expect(payoutFindFirst).toHaveBeenCalledWith({
      where: {
        campaignId: 'campaign-1',
        status: 'COMPLETED',
        OR: [{ usageReport: null }, { usageReport: { disputedAt: { not: null } } }],
      },
      orderBy: { completedAt: 'asc' },
    });
  });

  it('returns whatever the query finds', async () => {
    const blocking = payoutRow({ id: 'payout-old' });
    const tx = { payout: { findFirst: vi.fn().mockResolvedValue(blocking) } };

    await expect(campaignBlockingUsageReport(tx as never, 'campaign-1')).resolves.toBe(blocking);
  });
});
