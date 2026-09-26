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
 * DIFFERENT, simpler rule and never calls this function; `tripFeeRefund`
 * below decides which rule applies.
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

/**
 * The three Trip Fee Refund rules of CONTEXT.md (Trip Fee), one case each:
 *   - 'volunteer cancel': the Volunteer cancels their own paid
 *     Registration, refunded by the tier `tripFeeRefundAmount` sets;
 *   - 'batch cancel': the Fundraiser cancels the Batch, refunded in full
 *     whenever it happens;
 *   - 'late settlement': the Trip Fee settles after the Registration was
 *     already cancelled, refunded in full automatically.
 */
export type TripFeeRefundCase = 'volunteer cancel' | 'batch cancel' | 'late settlement';

/**
 * The Trip Fee Refund policy: the amount and reason to refund a paid
 * Registration in each case, as of `now`. An amount of 0 means no Refund is
 * owed (a Volunteer cancelling inside the no-refund window). The Volunteer
 * Trip module (./trip.ts) is its only caller and passes both straight to
 * `createRefund`.
 */
export function tripFeeRefund(
  registration: { batch: { startDate: Date }; payment: { amount: number } },
  refundCase: TripFeeRefundCase,
  now: Date,
): { amount: number; reason: string } {
  const paidAmount = registration.payment.amount;
  switch (refundCase) {
    case 'volunteer cancel':
      return {
        amount: tripFeeRefundAmount({ departureDate: registration.batch.startDate, now, paidAmount }),
        reason: 'Volunteer membatalkan Registrasi',
      };
    case 'batch cancel':
      return { amount: paidAmount, reason: 'Batch dibatalkan karena tidak mencapai kuota minimum' };
    case 'late settlement':
      return {
        amount: paidAmount,
        reason: 'Trip Fee settlement arrived after the Registration was already cancelled -- refunded automatically',
      };
  }
}
