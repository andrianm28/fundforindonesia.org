import { describe, it, expect, vi } from 'vitest';
import {
  InvalidZakatDistributionError,
  ZAKAT_ASNAF,
  ZakatDistributionExceedsReceivedError,
  ZakatRecipientNotConfiguredError,
  listZakatDistributions,
  recordZakatDistribution,
  zakatPosition,
} from './zakat-distributions';
import { OPERATIONS_KEY } from './operations';
import { countedPaymentWhere } from './money/counted-payment';

/**
 * Zakat distribution records (PKS pemenuhan 19, ADR 0028): an Admin writes
 * down what the zakat institution gave to mustahik. A record only. The fake
 * below has NO ledger table and NO Payout table, so a record that tried to
 * move money would throw instead of passing.
 */

const NOW = new Date('2026-11-09T05:00:00.000Z');
const ADMIN = { actorId: 'admin-1', now: NOW };
const ZAKAT_ON = { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' };

function fakeDb(opts: { zakat?: unknown; received?: number; distributed?: number; refunded?: number } = {}) {
  const created: Record<string, unknown>[] = [];
  const zakat = opts.zakat === undefined ? ZAKAT_ON : opts.zakat;
  const donationAggregate = vi.fn(async () => ({ _sum: { amount: opts.received ?? 0 } }));
  const refundAggregate = vi.fn(async () => ({ _sum: { amount: opts.refunded ?? 0 } }));
  const distributionAggregate = vi.fn(async () => ({ _sum: { amount: opts.distributed ?? 0 } }));
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    created.push(data);
    return { id: `z${created.length}`, ...data };
  });
  const queryRaw = vi.fn(async () => [{}]);
  const tx = {
    siteSetting: {
      findUnique: vi.fn(async () => ({
        key: OPERATIONS_KEY,
        value: { donationsOpen: true, maintenance: { on: false, message: '' }, zakat, history: [] },
        updatedAt: new Date(1),
      })),
    },
    donation: { aggregate: donationAggregate },
    refund: { aggregate: refundAggregate },
    zakatDistribution: { aggregate: distributionAggregate, create, findMany: vi.fn(async () => created) },
    $queryRaw: queryRaw,
  };
  const db = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } as never;
  return { db, created, create, queryRaw, donationAggregate, refundAggregate };
}

const INPUT = {
  amount: 500_000,
  asnaf: 'FAKIR',
  distributedAt: '2026-11-08',
  recipientSummary: '  25 keluarga di Desa Contoh  ',
  note: 'Paket sembako',
};

describe('zakatPosition', () => {
  it('is what the institution received, what it distributed, and what is left', async () => {
    const { db, donationAggregate } = fakeDb({ received: 3_000_000, distributed: 1_200_000 });

    expect(await zakatPosition(db, 'org-1')).toEqual({ received: 3_000_000, distributed: 1_200_000, remaining: 1_800_000 });
    // Real money only: the ONE counted-payment rule, never a hand-written sandbox filter.
    expect(donationAggregate).toHaveBeenCalledWith({
      where: {
        paymentStatus: 'confirmed',
        payments: { some: countedPaymentWhere() },
        campaign: { kind: 'ZAKAT', collectingEntityId: 'org-1' },
      },
      _sum: { amount: true },
    });
  });

  it('nets out refunds of counted zakat Payments, full and partial', async () => {
    const { db, refundAggregate } = fakeDb({ received: 3_000_000, refunded: 1_000_000, distributed: 500_000 });

    // Donation.paymentStatus stays confirmed through a Refund (Payment goes REFUNDED only on a full one),
    // so the Refund rows are what is subtracted.
    expect(await zakatPosition(db, 'org-1')).toEqual({ received: 2_000_000, distributed: 500_000, remaining: 1_500_000 });
    expect(refundAggregate).toHaveBeenCalledWith({
      where: {
        status: { in: ['APPROVED', 'PROCESSING', 'COMPLETED'] },
        payment: {
          ...countedPaymentWhere(),
          donation: { campaign: { kind: 'ZAKAT', collectingEntityId: 'org-1' } },
        },
      },
      _sum: { amount: true },
    });
  });

  it('never reports a negative amount received', async () => {
    const { db } = fakeDb({ received: 100_000, refunded: 300_000 });
    expect((await zakatPosition(db, 'org-1')).received).toBe(0);
  });

  it('is all zero before anything came in', async () => {
    const { db } = fakeDb();
    expect(await zakatPosition(db, 'org-1')).toEqual({ received: 0, distributed: 0, remaining: 0 });
  });
});

describe('recordZakatDistribution', () => {
  it('records the distribution against the configured recipient, with the acting Admin, and nothing else', async () => {
    const { db, created, queryRaw } = fakeDb({ received: 3_000_000, distributed: 1_000_000 });

    await recordZakatDistribution(db, { ...ADMIN, input: INPUT });

    expect(created).toEqual([
      {
        organisationId: 'org-1',
        amount: 500_000,
        asnaf: 'FAKIR',
        distributedAt: new Date('2026-11-07T17:00:00.000Z'), // 2026-11-08 00:00 WIB
        recipientSummary: '25 keluarga di Desa Contoh',
        note: 'Paket sembako',
        recordedById: 'admin-1',
      },
    ]);
    // Serialised per institution, so two Admins cannot both spend the same remainder.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('allows distributing exactly what is left, and refuses a rupiah more, recording nothing', async () => {
    const exact = fakeDb({ received: 1_500_000, distributed: 1_000_000 });
    await recordZakatDistribution(exact.db, { ...ADMIN, input: INPUT });
    expect(exact.created).toHaveLength(1);

    const over = fakeDb({ received: 1_499_999, distributed: 1_000_000 });
    const error = await recordZakatDistribution(over.db, { ...ADMIN, input: INPUT }).catch((e) => e);
    expect(error).toBeInstanceOf(ZakatDistributionExceedsReceivedError);
    expect(error.message).toMatch(/Rp499\.999/);
    expect(over.create).not.toHaveBeenCalled();
  });

  it('refuses when no recipient is configured', async () => {
    const { db, create } = fakeDb({ zakat: { enabled: true, nisabAmount: 1, recipientOrganisationId: null }, received: 9_000_000 });
    await expect(recordZakatDistribution(db, { ...ADMIN, input: INPUT })).rejects.toBeInstanceOf(ZakatRecipientNotConfiguredError);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['a zero amount', { amount: 0 }],
    ['a fractional amount', { amount: 1000.5 }],
    ['a negative amount', { amount: -1 }],
    ['an amount that is not a number', { amount: '500000' }],
    ['an asnaf outside the eight', { asnaf: 'LAINNYA' }],
    ['a date that is not a date', { distributedAt: 'kemarin' }],
    ['a date in the future', { distributedAt: '2026-11-11' }],
    ['a blank recipient summary', { recipientSummary: '   ' }],
    ['a recipient summary over 300 characters', { recipientSummary: 'a'.repeat(301) }],
    ['a note over 500 characters', { note: 'a'.repeat(501) }],
  ])('refuses %s and records nothing', async (_why, override) => {
    const { db, create } = fakeDb({ received: 9_000_000 });
    const error = await recordZakatDistribution(db, { ...ADMIN, input: { ...INPUT, ...override } }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidZakatDistributionError);
    expect(create).not.toHaveBeenCalled();
  });

  it('knows all eight asnaf', () => {
    expect([...ZAKAT_ASNAF].sort()).toEqual(
      ['AMIL', 'FAKIR', 'FISABILILLAH', 'GHARIM', 'IBNU_SABIL', 'MISKIN', 'MUALAF', 'RIQAB'],
    );
  });
});

describe('listZakatDistributions', () => {
  it('lists newest first for the institution', async () => {
    const findMany = vi.fn(async () => []);
    await listZakatDistributions({ zakatDistribution: { findMany } } as never, 'org-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organisationId: 'org-1' }, orderBy: [{ distributedAt: 'desc' }, { recordedAt: 'desc' }] }),
    );
  });
});
