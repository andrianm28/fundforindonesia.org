import { describe, it, expect } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { refundFreezeDebit } from './ledger';
import { RefundFreezeJournalMissingError } from './errors';
import { STANDING_REFUND_WHERE, isRefundStanding, readRefundFreezeEntries } from './refund-standing';

describe('isRefundStanding', () => {
  it.each([
    ['REQUESTED', true],
    ['APPROVED', true],
    ['PROCESSING', true],
    ['COMPLETED', true],
    ['REJECTED', false],
    ['FAILED', false],
  ])('%s -> %s', (status, standing) => {
    expect(isRefundStanding({ status })).toBe(standing);
  });

  it('names the same two statuses in the Prisma filter', () => {
    expect(STANDING_REFUND_WHERE).toEqual({ status: { notIn: ['REJECTED', 'FAILED'] } });
  });
});

describe('readRefundFreezeEntries', () => {
  const txWith = (rows: unknown[]) => {
    const calls: unknown[] = [];
    const tx = {
      ledgerEntry: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return rows;
        },
      },
    } as never as Prisma.TransactionClient;
    return { tx, calls };
  };

  it('reads nothing when no Refund stands', async () => {
    const { tx, calls } = txWith([]);
    expect(await readRefundFreezeEntries(tx, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns the entries so refundFreezeDebit can read them', async () => {
    const rows = [{ transactionId: 'refund-requested-r1', account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 90 }];
    const { tx } = txWith(rows);
    const entries = await readRefundFreezeEntries(tx, ['r1']);
    expect(refundFreezeDebit(entries, 'r1', 'ESCROW_HOLD')).toBe(90);
  });

  it('refuses with one domain error naming every Refund whose journal is missing', async () => {
    const { tx } = txWith([
      { transactionId: 'refund-requested-r1', account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 90 },
    ]);
    const err = await readRefundFreezeEntries(tx, ['r1', 'r2', 'r3']).catch((e) => e);
    expect(err).toBeInstanceOf(RefundFreezeJournalMissingError);
    expect(err.refundIds).toEqual(['r2', 'r3']);
    expect(err.message).toContain('r2, r3');
    expect(domainErrorToHttp(err)).toMatchObject({
      status: 500,
      body: { code: 'REFUND_FREEZE_JOURNAL_MISSING' },
    });
  });
});
