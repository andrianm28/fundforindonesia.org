import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/contact-fields', () => ({
  readBankAccountNumber: vi.fn(() => '1234567890'),
  SELECT_BANK_ACCOUNT_NUMBER: { accountNumberCiphertext: true, accountNumberKeyId: true },
}));

import { revealPayoutAccountNumber } from './payout-reveal';
import { readBankAccountNumber } from '@/lib/contact-fields';
import { InvalidPayoutStatusError, PayoutNotFoundError, TwoPersonRuleError } from './errors';

function payout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payout-1',
    status: 'APPROVED',
    requestedById: 'requester-1',
    approvedById: 'approver-1',
    bankAccount: { accountNumberCiphertext: 'ct', accountNumberKeyId: 'k1' },
    ...overrides,
  };
}

function prismaWith(found: unknown) {
  const create = vi.fn().mockResolvedValue({ id: 'reveal-1' });
  const tx = { payout: { findUnique: vi.fn().mockResolvedValue(found) }, payoutAccountReveal: { create } };
  const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma: prisma as never, tx, create };
}

describe('revealPayoutAccountNumber', () => {
  it('returns the number to the settling Admin and writes one audit row', async () => {
    const { prisma, create } = prismaWith(payout());
    const number = await revealPayoutAccountNumber(prisma, { payoutId: 'payout-1', revealedById: 'admin-3' });
    expect(number).toBe('1234567890');
    expect(create).toHaveBeenCalledWith({ data: { payoutId: 'payout-1', revealedById: 'admin-3' } });
  });

  it('refuses the requester and the approver without decrypting or auditing', async () => {
    for (const actor of ['requester-1', 'approver-1']) {
      const { prisma, create } = prismaWith(payout());
      vi.mocked(readBankAccountNumber).mockClear();
      await expect(revealPayoutAccountNumber(prisma, { payoutId: 'payout-1', revealedById: actor })).rejects.toThrow(
        TwoPersonRuleError,
      );
      expect(create).not.toHaveBeenCalled();
      expect(readBankAccountNumber).not.toHaveBeenCalled();
    }
  });

  it.each(['DRAFT', 'COMPLETED', 'REJECTED'])('refuses a %s Payout', async (status) => {
    const { prisma, create } = prismaWith(payout({ status }));
    await expect(revealPayoutAccountNumber(prisma, { payoutId: 'payout-1', revealedById: 'admin-3' })).rejects.toThrow(
      InvalidPayoutStatusError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an APPROVED Payout with no recorded approver', async () => {
    const { prisma } = prismaWith(payout({ approvedById: null }));
    await expect(revealPayoutAccountNumber(prisma, { payoutId: 'payout-1', revealedById: 'admin-3' })).rejects.toThrow(
      TwoPersonRuleError,
    );
  });

  it('404s an unknown Payout', async () => {
    const { prisma } = prismaWith(null);
    await expect(revealPayoutAccountNumber(prisma, { payoutId: 'nope', revealedById: 'admin-3' })).rejects.toThrow(
      PayoutNotFoundError,
    );
  });
});
