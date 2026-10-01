import { refundTiers, type RefundTierKey } from '@/lib/volunteer/refund-table';
import { formatRupiah } from '@/lib/utils/currency';

const TIER_LABEL: Record<RefundTierKey, string> = {
  FULL: 'Refund penuh',
  HALF: 'Refund separuh',
  NONE: 'Tanpa Refund',
};

/**
 * The Refund table a Volunteer reads BEFORE paying the Trip Fee: three tiers
 * with the real dates of this Batch (ticket 36, owner decision Q8). Cut from
 * the policy's own thresholds by `refundTiers`. Takes an ISO string so it can
 * sit in a server page or a client tree alike; imports no server module.
 */
export function RefundTierTable({ startDate, tripFee }: { startDate: string; tripFee: number }) {
  const tiers = refundTiers({ startDate: new Date(startDate), tripFee });
  return (
    <table className="w-full text-sm border border-border rounded-lg">
      <caption className="text-left text-sm text-text-secondary mb-2">
        Jika Anda membatalkan setelah membayar, Refund Trip Fee mengikuti waktu pembatalan:
      </caption>
      <thead>
        <tr className="text-left text-text-secondary">
          <th scope="col" className="p-2">Waktu pembatalan</th>
          <th scope="col" className="p-2">Refund</th>
        </tr>
      </thead>
      <tbody>
        {tiers.map((tier) => (
          <tr key={tier.key} className="border-t border-border align-top">
            <td className="p-2 text-text">{tier.window}</td>
            <td className="p-2 font-medium text-text">
              <span className="block text-xs text-text-secondary">{TIER_LABEL[tier.key]}</span>
              {formatRupiah(tier.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
