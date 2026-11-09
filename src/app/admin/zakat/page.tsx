import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';
import { resolveOperationsOrDefaults } from '@/lib/operations';
import {
  financeRecap,
  InvalidRecapPeriodError,
  splitZakatFromRecap,
  wibMonthOf,
  type FinanceRecap,
} from '@/lib/money/finance-recap';
import { listZakatDistributions, zakatPosition, ZAKAT_ASNAF_LABEL } from '@/lib/zakat-distributions';
import { AdminZakatDistributionForm } from '@/components/admin/AdminZakatDistributionForm';

export const dynamic = 'force-dynamic';

type RouteContext = { searchParams: Promise<{ from?: string; to?: string }> };

/**
 * Modul zakat for the Admin (PKS pemenuhan 19, ADR 0028): what the configured
 * institution received as zakat, what has been recorded as distributed and what
 * is left; the transactions CSV; the distribution records; and the ledger
 * figures of the period with zakat kept apart from general donations. A 404
 * while the module is off. Admin only: the Admin layout answers anyone else
 * with the same 404 as a missing page.
 */
export default async function AdminZakatPage({ searchParams }: RouteContext) {
  const { zakat } = await resolveOperationsOrDefaults(prisma);
  if (!zakat.enabled) notFound();

  const params = await searchParams;
  const current = wibMonthOf(new Date());
  const from = params.from ?? current;
  const to = params.to ?? from;

  const organisationId = zakat.recipientOrganisationId;
  const [position, distributions] =
    organisationId === null
      ? [{ received: 0, distributed: 0, remaining: 0 }, []]
      : await Promise.all([zakatPosition(prisma, organisationId), listZakatDistributions(prisma, organisationId)]);

  let recap: FinanceRecap | null = null;
  let error: string | null = null;
  try {
    recap = await financeRecap(prisma, { from, to });
  } catch (err) {
    if (!(err instanceof InvalidRecapPeriodError)) throw err;
    error = err.message;
  }
  const split = recap ? splitZakatFromRecap(recap) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Zakat</h1>
        <p className="mt-1 text-gray-600">
          Zakat dikumpulkan lewat Campaign zakat milik lembaga penerima, dengan jalur donasi yang sama. Angka di bawah
          dipisahkan dari donasi umum.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['zakat-received', 'Zakat diterima lembaga', position.received],
            ['zakat-distributed', 'Sudah dicatat disalurkan', position.distributed],
            ['zakat-remaining', 'Sisa belum disalurkan', position.remaining],
          ] as const
        ).map(([id, label, value]) => (
          <div key={id} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-600">{label}</p>
            <p data-testid={id} className="mt-1 text-xl font-semibold text-gray-900">
              {formatRupiah(value)}
            </p>
          </div>
        ))}
      </section>
      <p className="-mt-4 text-xs text-gray-500">
        Hanya uang sungguhan yang sudah terkonfirmasi; uang uji beta tidak dihitung.
        {organisationId === null && ' Lembaga penerima belum ditetapkan di Pengaturan Operasional.'}
      </p>

      <form method="get" className="flex flex-wrap items-end gap-3">
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
            href={`/api/admin/zakat/transaksi?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
          >
            Unduh CSV transaksi zakat
          </a>
        )}
      </form>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
          {error}
        </p>
      )}

      {split && (
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">Buku besar periode ini</h2>
          <p className="mb-3 text-sm text-gray-600">Donasi diterima menurut buku besar, zakat dan donasi umum terpisah.</p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-gray-600">Zakat</dt>
              <dd data-testid="ledger-zakat" className="font-semibold text-gray-900">
                {formatRupiah(split.zakat.totals.donasiDiterima)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-600">Donasi umum (tanpa zakat)</dt>
              <dd data-testid="ledger-general" className="font-semibold text-gray-900">
                {formatRupiah(split.general.totals.donasiDiterima)}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <AdminZakatDistributionForm remaining={position.remaining} />

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Catatan penyaluran</h2>
        {distributions.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">Belum ada penyaluran yang dicatat.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="py-2 pr-4">Tanggal</th>
                  <th className="py-2 pr-4">Golongan</th>
                  <th className="py-2 pr-4">Nominal</th>
                  <th className="py-2 pr-4">Penerima</th>
                  <th className="py-2 pr-4">Dicatat oleh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {distributions.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {new Date(d.distributedAt).toLocaleDateString('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' })}
                    </td>
                    <td className="py-2 pr-4">{ZAKAT_ASNAF_LABEL[d.asnaf]}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{formatRupiah(d.amount)}</td>
                    <td className="py-2 pr-4">
                      <span>{d.recipientSummary}</span>
                      {d.note && <span className="block text-xs text-gray-500">{d.note}</span>}
                    </td>
                    <td className="py-2 pr-4">{d.recordedBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
