import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { impactBreakdown, ImpactDoesNotReconcileError } from '@/lib/money/impact';
import { formatRupiah } from '@/lib/utils/currency';

/**
 * Impact & Transparency, the page a visitor is asked to trust (ticket 25;
 * PRD FFI-14). Every figure on it is summed out of the ledger by
 * impactBreakdown (src/lib/money/impact.ts) and the six lines are guaranteed
 * there to add up to the collected total before this page ever renders them.
 *
 * When they cannot -- money moved that no settled Payment accounts for --
 * nothing is rendered. A page that shows six lines which do not sum to the
 * number above them is worse than a page that admits the books are broken, so
 * the failure is stated plainly and the figures stay hidden.
 *
 * Rendered per request, not prerendered, for the same reason as the homepage
 * (src/app/page.tsx): the Docker build has no database, so a baked page would
 * ship an empty Impact page forever.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Impact & Transparency - Fund for Indonesia',
  description:
    'Ke mana setiap rupiah yang diberikan kepada Fund for Indonesia. Enam baris yang jumlahnya persis sama dengan dana terkumpul, dihitung dari buku besar.',
};

interface ImpactPageProps {
  searchParams: Promise<{ location?: string }>;
}

export default async function ImpactPage({ searchParams }: ImpactPageProps) {
  const { location } = await searchParams;

  let breakdown;
  try {
    breakdown = await impactBreakdown(prisma, { location });
  } catch (error) {
    if (!(error instanceof ImpactDoesNotReconcileError)) throw error;
    console.error(`[impact] page refusing to render figures: ${error.message}`);
    return (
      <article>
        <h1 className="text-2xl font-bold text-text mb-6">Impact &amp; Transparency</h1>
        <p data-testid="impact-does-not-reconcile" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
          Angka impact sedang tidak dapat ditampilkan karena catatan keuangan kami tidak balancing. Kami
          memilih menampilkan nihil daripada menampilkan angka yang tidak dapat dipertanggungjawabkan.
        </p>
      </article>
    );
  }

  const linesTotal = breakdown.lines.reduce((total, line) => total + line.amount, 0);
  const platformCostTotal =
    breakdown.platformCost.unrecoveredProviderFee + breakdown.platformCost.uncoveredRefunds;

  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-2">Impact &amp; Transparency</h1>
      <p className="text-text-secondary leading-relaxed mb-6">
        Setiap rupiah yang Donor berikan dihitung dari buku besar kami, lalu diurai ke dalam enam
        baris yang jumlahnya persis sama dengan dana terkumpul.
      </p>

      <form method="get" action="/impact" className="flex flex-wrap items-end gap-2 mb-8">
        <div>
          <label htmlFor="location" className="block text-sm font-medium text-text mb-1">
            Filter lokasi
          </label>
          <input
            id="location"
            name="location"
            defaultValue={breakdown.location ?? ''}
            placeholder="mis. Jawa Barat"
            className="px-3 py-2 text-sm border border-border rounded-md text-text"
          />
        </div>
        <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md">
          Terapkan
        </button>
        {breakdown.location ? (
          <Link href="/impact" className="px-4 py-2 text-sm text-primary hover:underline">
            Hapus filter
          </Link>
        ) : null}
      </form>

      {breakdown.location ? (
        <p data-testid="impact-location-filter" className="text-sm text-text-secondary mb-4">
          Menampilkan dampak untuk lokasi <span className="font-medium text-text">{breakdown.location}</span>.
        </p>
      ) : null}

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-text">Terkumpul</h2>
        <p data-testid="impact-collected" className="text-3xl font-bold text-text">
          {formatRupiah(breakdown.collected)}
        </p>
        <p className="text-sm text-text-secondary mt-1">
          Gross seluruh Payment yang Settlement{breakdown.manualContributions > 0
            ? ` ditambah Manual Contribution ${formatRupiah(breakdown.manualContributions)}`
            : ''}. Campaign yang disembunyikan sebagai Demo Campaign tidak dihitung, dan Donation yang
          direfund tetap terhitung karena uangnya memang pernah masuk.
        </p>
      </section>

      <table className="w-full text-sm mb-2">
        <caption className="sr-only">Enam baris asal usul dana terkumpul</caption>
        <tbody>
          {breakdown.lines.map((line) => (
            <tr key={line.key} className="border-b border-border">
              <th scope="row" className="py-2 text-left font-normal text-text-secondary">
                {line.label}
              </th>
              <td data-testid={`impact-line-${line.key}`} className="py-2 text-right font-medium text-text">
                {formatRupiah(line.amount)}
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-2 text-left font-semibold text-text">
              Total enam baris
            </th>
            <td className="py-2 text-right font-semibold text-text">{formatRupiah(linesTotal)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-sm text-text-secondary mb-8">
        Total enam baris sama dengan dana terkumpul: {formatRupiah(linesTotal)}.{' '}
        {breakdown.disbursedNotYetCompleted > 0
          ? `Sebesar ${formatRupiah(breakdown.disbursedNotYetCompleted)} sudah instructing dari saldo Campaign tetapi belum ditandai selesai oleh Admin.`
          : null}
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-text mb-2">Penerima manfaat</h2>
        <p data-testid="impact-beneficiaries" className="text-2xl font-bold text-text">
          {breakdown.beneficiaries.toLocaleString('id-ID')} orang
        </p>
        <p className="text-sm text-text-secondary mt-1">
          Penerima manfaat adalah jumlah orang dari Usage Report yang diterima tiap Fundraiser untuk
          setiap Payout, bukan uang.
        </p>
      </section>

      {platformCostTotal > 0 ? (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-text mb-2">Biaya platform di luar dana terkumpul</h2>
          <p data-testid="impact-platform-cost" className="text-2xl font-bold text-text">
            {formatRupiah(platformCostTotal)}
          </p>
          <p className="text-sm text-text-secondary mt-1">
            Uang ini adalah milik platform, bukan bagian dari dana yang dikumpulkan Campaign, jadi
            tidak dihitung di dalam enam baris di atas:{' '}
            {formatRupiah(breakdown.platformCost.unrecoveredProviderFee)} Provider Fee yang tidak
            kembali pada Refund penuh, dan {formatRupiah(breakdown.platformCost.uncoveredRefunds)}{' '}
            Refund yang tidak lagi tertutup dana Campaign karena saldonya sudah dicairkan.
          </p>
        </section>
      ) : null}

      <ul className="text-sm text-text-secondary list-disc pl-5 space-y-1">
        {breakdown.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </article>
  );
}
