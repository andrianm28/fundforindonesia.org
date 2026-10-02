import type { PrismaClient } from '@/generated/prisma/client';
import { programBalance } from '@/lib/money/ledger';

/**
 * The two CSR money figures a Program page shows (ticket csr-08; PRD FFI-14),
 * kept in separate fields because they are different kinds of number:
 *
 * - `inTheBooks` is the Program Balance, read from the ledger by the same
 *   `programBalance` the Manual Contribution flow uses. It is money that
 *   crossed the platform's account and that the ledger can account for.
 * - `outsideTheBooks` is the plain figure an Admin reported for CSR money that
 *   never crossed the platform's account. No ledger entry stands behind it,
 *   by design, and nothing here adds it to the other.
 *
 * Only an amount and its "as of" date are public. `reportedNote` is free text
 * an Admin may use to name a counterparty, so it is deliberately not selected
 * (owner decision, csr-08). Lives apart from src/lib/programs.ts so the
 * catalog module keeps no path to the ledger.
 */
export type ProgramMoney = {
  inTheBooks: number;
  outsideTheBooks: { amount: number; asOf: Date | null };
};

export async function readProgramMoney(db: PrismaClient, programId: string): Promise<ProgramMoney> {
  const [inTheBooks, reported] = await Promise.all([
    programBalance(db, programId),
    db.program.findUnique({ where: { id: programId }, select: { reportedAmount: true, reportedAsOf: true } }),
  ]);
  return {
    inTheBooks,
    outsideTheBooks: { amount: reported?.reportedAmount ?? 0, asOf: reported?.reportedAsOf ?? null },
  };
}
