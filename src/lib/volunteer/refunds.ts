const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The tiered-by-time-to-departure refund amount for a Volunteer-initiated
 * cancellation of their own CONFIRMED Registration. Thresholds and
 * percentages are this function's own contract -- no upstream spec pins
 * them down (see .scratch/volunteer-trip/spec.md's "Trip Fee refund rule"
 * and Further Notes): >= 14 days before departure refunds in full; 3-13
 * days before departure refunds half; inside 3 days of departure, or on/
 * after departure itself, refunds nothing.
 *
 * A Fundraiser-cancelled Batch (100% refund regardless of timing) is a
 * DIFFERENT, simpler rule and never calls this function -- see the
 * Batch-cancel route (Task 3) instead.
 *
 * Rounds down: a fractional Rupiah never rounds in the Volunteer's favor,
 * so the refund never exceeds paidAmount * the tier's percentage.
 */
export function tripFeeRefundAmount(params: {
  departureDate: Date;
  now: Date;
  paidAmount: number;
}): number {
  const { departureDate, now, paidAmount } = params;
  const daysToDeparture = Math.floor((departureDate.getTime() - now.getTime()) / MS_PER_DAY);

  if (daysToDeparture >= 14) return paidAmount;
  if (daysToDeparture >= 3) return Math.floor(paidAmount / 2);
  return 0;
}
