import { formatWibDate, WIB_OFFSET_MS } from './batch-dates';
import { FULL_REFUND_MIN_DAYS, HALF_REFUND_MIN_DAYS, tripFeeRefundAmount } from './refunds';

/**
 * The tiered Refund table a Volunteer sees BEFORE paying the Trip Fee
 * (ticket 36, owner decision 2026-09-29), cut from the thresholds and the
 * amount rule of `tripFeeRefundAmount` itself so the screen cannot promise
 * what the policy would not refund. Plain module: safe for client code.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "6 Okt 2026 07.00 WIB": always WIB, whatever timezone the server runs in. */
export function formatBoundary(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${formatWibDate(date)} ${hh}.${mm} WIB`;
}

export type RefundTierKey = 'FULL' | 'HALF' | 'NONE';
export type RefundTier = { key: RefundTierKey; amount: number; window: string };

export function refundTiers(params: { startDate: Date; tripFee: number }): RefundTier[] {
  const { startDate, tripFee } = params;
  const fullUntil = new Date(startDate.getTime() - FULL_REFUND_MIN_DAYS * MS_PER_DAY);
  const halfUntil = new Date(startDate.getTime() - HALF_REFUND_MIN_DAYS * MS_PER_DAY);
  // Amounts are asked of the policy at an instant inside each tier.
  const amountAt = (now: Date) => tripFeeRefundAmount({ departureDate: startDate, now, paidAmount: tripFee });
  return [
    {
      key: 'FULL',
      amount: amountAt(fullUntil),
      window: `Sampai ${formatBoundary(fullUntil)} (${FULL_REFUND_MIN_DAYS} hari penuh atau lebih sebelum berangkat)`,
    },
    {
      key: 'HALF',
      amount: amountAt(halfUntil),
      window: `Setelah ${formatBoundary(fullUntil)} sampai ${formatBoundary(halfUntil)} (${HALF_REFUND_MIN_DAYS} sampai ${FULL_REFUND_MIN_DAYS - 1} hari sebelum berangkat)`,
    },
    {
      key: 'NONE',
      amount: amountAt(startDate),
      window: `Setelah ${formatBoundary(halfUntil)} (kurang dari ${HALF_REFUND_MIN_DAYS} hari sebelum berangkat)`,
    },
  ];
}
