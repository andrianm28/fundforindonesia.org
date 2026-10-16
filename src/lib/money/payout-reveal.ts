import type { PrismaClient } from '@/generated/prisma/client';
import { readBankAccountNumber, SELECT_BANK_ACCOUNT_NUMBER } from '@/lib/contact-fields';
import { InvalidPayoutStatusError, PayoutNotFoundError, TwoPersonRuleError } from './errors';

/**
 * The one place a Payout's destination account number is decrypted (ticket
 * 89; owner decision C6, 2026-10-04; amends ticket 12). Payouts are made by
 * hand in the provider's dashboard (ADR 0006), so the Admin who will mark the
 * Payout complete has to type the full number.
 *
 * Who: any Admin except the Payout's requester and approver -- the same
 * person completePayout would accept. When: only while the Payout is
 * APPROVED. Every successful call writes a PayoutAccountReveal row first,
 * inside the same transaction, so a read can never happen without its trace
 * (ADR 0012's ciphertext is randomized: a read cannot be found afterwards).
 *
 * The number is returned to the caller and goes nowhere else: not stored,
 * not logged.
 */
export async function revealPayoutAccountNumber(
  prisma: PrismaClient,
  params: { payoutId: string; revealedById: string },
): Promise<string> {
  const { payoutId, revealedById } = params;

  return prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({
      where: { id: payoutId },
      select: {
        id: true,
        status: true,
        requestedById: true,
        approvedById: true,
        bankAccount: { select: SELECT_BANK_ACCOUNT_NUMBER },
      },
    });
    if (!payout) throw new PayoutNotFoundError(payoutId);
    if (payout.status !== 'APPROVED') throw new InvalidPayoutStatusError(payout.status);
    if (!payout.approvedById || payout.approvedById === revealedById || payout.requestedById === revealedById) {
      throw new TwoPersonRuleError();
    }

    await tx.payoutAccountReveal.create({ data: { payoutId, revealedById } });

    const number = readBankAccountNumber(payout.bankAccount);
    if (number === null) throw new Error('Payout bank account has no account number.');
    return number;
  });
}
