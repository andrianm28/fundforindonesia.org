export interface DonationRecord {
  amount: number;
  paymentStatus: 'pending' | 'confirmed' | 'failed';
}

/**
 * Calculates the expected collectedAmount from a list of donations.
 * Only confirmed donations count toward the total.
 */
export function calculateCollectedAmount(donations: DonationRecord[]): number {
  return donations
    .filter(d => d.paymentStatus === 'confirmed')
    .reduce((sum, d) => sum + d.amount, 0);
}
