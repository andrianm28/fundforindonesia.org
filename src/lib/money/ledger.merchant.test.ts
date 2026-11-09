// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { postTransaction, providerBalances, collectionAccountBalance, type LedgerLeg } from './ledger';

/**
 * pks-pemenuhan/04, scope 4: every posting carries the merchant entity (and the
 * collecting entity and actor where known), on every leg.
 */

const LEGS: LedgerLeg[] = [
  { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 100 },
  { account: 'PROVIDER_FEE', direction: 'CREDIT', amount: 100 },
];

function makeTx() {
  return { ledgerEntry: { createMany: vi.fn().mockResolvedValue({ count: 2 }), groupBy: vi.fn() } };
}

describe('postTransaction stamps the merchant entity', () => {
  it('writes merchantEntity on every leg', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, LEGS, { merchantEntity: 'BADAN_USAHA', transactionId: 't1' });
    const rows = tx.ledgerEntry.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { merchantEntity: string }) => r.merchantEntity)).toEqual(['BADAN_USAHA', 'BADAN_USAHA']);
  });

  it('writes collectingEntityId and actorId when given, null when not', async () => {
    const tx = makeTx();
    await postTransaction(tx as never, LEGS, {
      merchantEntity: 'YAYASAN',
      collectingEntityId: 'org-1',
      actorId: 'user-1',
    });
    await postTransaction(tx as never, LEGS, { merchantEntity: 'YAYASAN' });
    const [given, absent] = tx.ledgerEntry.createMany.mock.calls.map((c) => c[0].data[0]);
    expect(given).toMatchObject({ collectingEntityId: 'org-1', actorId: 'user-1' });
    expect(absent).toMatchObject({ collectingEntityId: null, actorId: null });
  });

  it('refuses a posting with no entity at runtime, even if the type was bypassed', async () => {
    const tx = makeTx();
    await expect(postTransaction(tx as never, LEGS, {} as never)).rejects.toThrow(/merchantEntity/);
    await expect(postTransaction(tx as never, LEGS, { merchantEntity: 'NOBODY' } as never)).rejects.toThrow(
      /merchantEntity/,
    );
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });
});

describe('balances can be read per merchant entity', () => {
  it('providerBalances filters on the entity when asked, and not otherwise', async () => {
    const tx = makeTx();
    tx.ledgerEntry.groupBy.mockResolvedValue([]);
    await providerBalances(tx as never);
    await providerBalances(tx as never, false, 'BADAN_USAHA');
    const [all, scoped] = tx.ledgerEntry.groupBy.mock.calls.map((c) => c[0].where);
    expect(all).toEqual({ account: 'GATEWAY_CLEARING', sandbox: false });
    expect(scoped).toEqual({ account: 'GATEWAY_CLEARING', sandbox: false, merchantEntity: 'BADAN_USAHA' });
  });

  it('collectionAccountBalance filters on the entity when asked', async () => {
    const tx = makeTx();
    tx.ledgerEntry.groupBy.mockResolvedValue([{ direction: 'DEBIT', _sum: { amount: 40 } }]);
    expect(await collectionAccountBalance(tx as never, false, 'YAYASAN')).toBe(40);
    expect(tx.ledgerEntry.groupBy.mock.calls[0][0].where).toMatchObject({ merchantEntity: 'YAYASAN' });
  });
});
