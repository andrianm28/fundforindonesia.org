/**
 * Determines campaign status based on collected amount, target, and deadline.
 * - If collected >= target → "completed"
 * - If deadline is in the past and collected < target → "expired"
 * - Otherwise → "active"
 */
export function determineCampaignStatus(
  collectedAmount: number,
  targetAmount: number,
  deadline: Date | null,
  now: Date = new Date()
): 'active' | 'completed' | 'expired' {
  if (collectedAmount >= targetAmount) return 'completed';
  if (deadline && deadline < now) return 'expired';
  return 'active';
}
