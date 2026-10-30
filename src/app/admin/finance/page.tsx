import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';
import {
  financeRecap,
  FINANCE_RECAP_COLUMNS,
  InvalidRecapPeriodError,
  wibMonthOf,
  type FinanceRecap,
} from '@/lib/money/finance-recap';
import { FINANCE_RECAP_HEADERS, NO_CAMPAIGN_LABEL } from '@/lib/money/finance-recap-csv';

// Rendered per request: it reads the ledger, which changes with every Payment.
export const dynamic = 'force-dynamic';

type RouteContext = { searchParams: Promise<{ from?: string; to?: string }> };

const TH = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';

/**
 * Rekap keuangan per periode x Kind x Campaign (ticket 79; PRD section 9). Every
 * figure is a sum of ledger entries (src/lib/money/finance-recap.ts defines
 * which movements count as which column and that a period is a WIB month);
 * the CSV export has the same columns. Read-only, real money only.
 */
export default async function AdminFinancePage({ searchParams }: RouteContext) {
  const params = await searchParams;
  const current = wibMonthOf(new Date());
  const from = params.from ?? current;
  const to = params.to ?? from;

  let recap: FinanceRecap | null = null;
  let error: string | null = null;
  try {
    recap = await financeRecap(prisma, { from, to });
  } catch (err) {
    if (!(err instanceof InvalidRecapPeriodError)) throw err;
    error = err.message;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Rekap Keuangan</h1>
        <p className="text-gray-600 mt-1">
          Angka dari buku besar, per bulan (WIB), Jenis, dan Campaign. Hanya uang sungguhan; uang uji beta tidak
          dihitung.
        </p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          Dari bulan
          <input type="month" name="from" defaultValue={from} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2" />
        </label>
        <label className="text-sm text-gray-700">
          Sampai bulan
          <input type="month" name="to" defaultValue={to} className="mt-1 block rounded-lg border border-gray-300 px-3 py-2" />
        </label>
        <button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">
          Tampilkan
        </button>
        {!error && (
          <a
            href={`/api/admin/finance/recap?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
          >
            Unduh CSV
          </a>
        )}
      </form>

      {error && (
        <p role="alert" className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-800">
          {error}
        </p>
      )}

      {recap && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className={TH}>{FINANCE_RECAP_HEADERS.period}</th>
                  <th className={TH}>{FINANCE_RECAP_HEADERS.kind}</th>
                  <th className={TH}>{FINANCE_RECAP_HEADERS.campaign}</th>
                  {FINANCE_RECAP_COLUMNS.map((c) => (
                    <th key={c} className={TH}>
                      {FINANCE_RECAP_HEADERS[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recap.rows.length === 0 ? (
                  <tr>
                    <td colSpan={3 + FINANCE_RECAP_COLUMNS.length} className="px-4 py-8 text-center text-gray-500">
                      Tidak ada pergerakan uang pada periode ini.
                    </td>
                  </tr>
                ) : (
                  recap.rows.map((row) => (
                    <tr key={`${row.period}-${row.campaignId ?? 'none'}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">{row.period}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{row.kind ?? ''}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{row.campaignTitle ?? NO_CAMPAIGN_LABEL}</td>
                      {FINANCE_RECAP_COLUMNS.map((c) => (
                        <td key={c} className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                          {formatRupiah(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
              {recap.rows.length > 0 && (
                <tfoot className="bg-gray-50">
                  <tr>
                    <th scope="row" colSpan={3} className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                      Total
                    </th>
                    {FINANCE_RECAP_COLUMNS.map((c) => (
                      <td key={c} className="px-4 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">
                        {formatRupiah(recap.totals[c])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
