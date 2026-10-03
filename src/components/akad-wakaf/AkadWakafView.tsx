'use client';

import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';

export type AkadWakafViewProps = {
  wakifName: string | null;
  amount: number;
  purpose: string;
  nazhirName: string;
  createdAt: string;
};

/**
 * The Wakif's pledge document print page (CONTEXT.md, Akad Wakaf), reachable
 * from the Receipt email and the dashboard alike, same as Receipt's own
 * print page. No resend action: this page's token link is itself the
 * reopenable copy, not something re-delivered on a cooldown.
 */
export function AkadWakafView(props: AkadWakafViewProps) {
  return (
    <div className="min-h-screen bg-bg-secondary py-10 px-4 print:bg-white print:py-0">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-xs p-6 print:shadow-none print:rounded-none">
        <h1 className="text-lg font-semibold text-text">Akad Wakaf</h1>

        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-text-secondary">Wakif</dt>
            <dd className="text-text font-medium">{props.wakifName || 'Wakif'}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Nominal</dt>
            <dd className="text-[#0073E6] font-bold">{formatRupiah(props.amount)}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Peruntukan</dt>
            <dd className="text-text font-medium">{props.purpose}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Nazhir</dt>
            <dd className="text-text font-medium">{props.nazhirName}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Tanggal</dt>
            <dd className="text-text">{formatIndonesianDate(new Date(props.createdAt))}</dd>
          </div>
        </dl>

        <div className="mt-6 flex gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 bg-[#0073E6] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#005BB5] transition-colors"
          >
            Cetak
          </button>
        </div>
      </div>
    </div>
  );
}
