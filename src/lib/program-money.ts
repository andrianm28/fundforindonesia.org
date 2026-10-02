import type { PrismaClient } from '@/generated/prisma/client';
import { programBooks } from '@/lib/money/manual-contributions';
import { assertCsrReconciles, CsrDoesNotReconcileError } from '@/lib/money/impact';

/**
 * The two CSR money figures a Program page shows (ticket csr-08; PRD FFI-14),
 * kept in separate fields because they are different kinds of number:
 *
 * - `inTheBooks` is the Program Balance, read from the ledger by the same
 *   `programBooks` (the Manual Contribution module). It is money that
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

/**
 * `reconciled: false` means this Program's balance fails the same
 * check /impact applies (assertCsrReconciles): the page hides the CSR block
 * and says so, with no figure at all, rather than failing the whole page.
 */
export type ProgramMoneyResult = ({ reconciled: true } & ProgramMoney) | { reconciled: false };

export async function readProgramMoney(db: PrismaClient, programId: string): Promise<ProgramMoneyResult> {
  const [{ booked: inTheBooks, explained }, reported] = await Promise.all([
    programBooks(db, [programId]),
    db.program.findUnique({ where: { id: programId }, select: { reportedAmount: true, reportedAsOf: true } }),
  ]);
  try {
    assertCsrReconciles(inTheBooks, explained);
  } catch (error) {
    if (!(error instanceof CsrDoesNotReconcileError)) throw error;
    console.error(`[program] CSR block hidden for program ${programId}: ${error.message}`);
    return { reconciled: false };
  }
  return {
    reconciled: true,
    inTheBooks,
    outsideTheBooks: { amount: reported?.reportedAmount ?? 0, asOf: reported?.reportedAsOf ?? null },
  };
}
