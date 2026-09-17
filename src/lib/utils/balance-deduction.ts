export interface BalanceDeductionResult {
  success: boolean;
  newBalance: number;
}

/**
 * Simulates a balance deduction for donation.
 * If amount <= balance, deducts and returns new balance.
 * If amount > balance, rejects and returns unchanged balance.
 */
export function deductBalance(balance: number, amount: number): BalanceDeductionResult {
  if (amount > balance) {
    return { success: false, newBalance: balance };
  }
  return { success: true, newBalance: balance - amount };
}
