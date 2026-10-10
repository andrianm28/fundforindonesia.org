import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Assignment, type PaymentStatus } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { hasAssignment } from '@/lib/assignment';
import { prisma } from '@/lib/prisma';
import { countedPaymentWhere, withCountedCollectedAmount } from '@/lib/money/counted-payment';
import { formatRupiah } from '@/lib/utils/currency';

export const dynamic = 'force-dynamic';

/**
 * Ticket 67 (plan A-3: `GET /api/admin/scrutiny` had no screen behind it): the
 * Admin's list of the two markers the System writes when a Donation settles
 * past a limit (src/lib/scrutiny.ts, prd-compliance 38; CONTEXT.md, Penanda
 * Audit and Penanda Donasi). A read and nothing else: a marker is a record that
 * the platform noticed a size, so this page has no button that dismisses,
 * blocks or reverses one, and opening it changes no Campaign.
 *
 * Read through Prisma like the other Admin pages. The route stays the JSON
 * view of the same rows; it does not apply this page's rules about beta data
 * and Donors below, so the two are not interchangeable.
 *
 * ADMIN ONLY, AND 404 OTHERWISE. The /admin proxy and layout already turn
 * everyone else away, but a layout does not run again on a client navigation,
 * so the page asks for itself, before it reads anything.
 *
 * NO DONOR ANYWHERE. Neither `select` below names a Donor column (no name, no
 * email, no phone, no link to an account), so an anonymous Donation's name
 * stays hidden because this page never holds one. What identifies a Donation
 * is its id, a reference to look the row up by.
 *
 * WHERE THE SUBJECT LINK GOES. An Admin has no Donation screen, and the Receipt
 * page is out: its token is the capability to open it, and it names the Donor.
 * So both lists link to the Campaign, and a Penanda Donasi shows the Donation's
 * id beside it.
 *
 * NO BETA DATA IN A FIGURE (ticket rilis-1-benda/92). Sandbox Payments are test
 * money, kept out of every real figure for good, yet both markers were judged
 * against counters that include them (scrutiny.ts reads the raw
 * collectedAmount; sorting that by mode is ticket 94's, and markers written
 * before it stay as they are). So:
 *   - a Penanda Donasi is listed only when its Donation settled with a Payment
 *     that counts. That is decided in the query, by countedPaymentWhere, so the
 *     100-row cut-off applies to the markers that are shown;
 *   - a Penanda Audit shows the Gross as withCountedCollectedAmount reads it,
 *     never the marker's own cumulativeGross snapshot, which cannot be sorted
 *     by mode after the fact. A marker whose counted Gross is not above the
 *     limit it was placed under is left out: only test money put it there. That
 *     cut comes after the 100-row limit, far above the number of Campaigns that
 *     ever reach the audit limit.
 */

const LIST_LIMIT = 100;

/**
 * A Donation counts through the Payment that settled it: PAID, or REFUNDED
 * after a full Refund (the lifetime counter never gives that Gross back; the
 * same two states uncountedGrossByCampaign reads).
 */
const SETTLED: PaymentStatus[] = ['PAID', 'REFUNDED'];

function formatWhen(at: Date): string {
  return at.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB';
}

const th = 'px-3 py-2 text-left text-xs font-semibold text-gray-500';
const td = 'px-3 py-2 text-sm text-gray-800';
const linkClass = 'font-medium text-blue-700 hover:underline';

/** Both lists point at the Campaign: the subject of an audit marker, and the place a Donation was made to. */
function CampaignLink({ campaign }: { campaign: { title: string; slug: string } }) {
  return (
    <Link href={`/campaign/${campaign.slug}`} className={linkClass}>
      {campaign.title}
    </Link>
  );
}

export default async function AdminScrutinyPage() {
  const session = await getServerSession();
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.ADMIN)) notFound();

  const [auditRows, donationMarkers] = await Promise.all([
    prisma.campaignAuditMarker.findMany({
      orderBy: { placedAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        id: true,
        threshold: true,
        placedAt: true,
        campaign: { select: { id: true, title: true, slug: true, collectedAmount: true } },
      },
    }),
    prisma.donationReviewMarker.findMany({
      where: { donation: { payments: { some: { ...countedPaymentWhere(), status: { in: SETTLED } } } } },
      orderBy: { flaggedAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        id: true,
        donationId: true,
        amount: true,
        threshold: true,
        flaggedAt: true,
        campaign: { select: { title: true, slug: true } },
      },
    }),
  ]);

  const counted = await withCountedCollectedAmount(
    prisma,
    auditRows.map((row) => row.campaign),
  );
  const grossByCampaign = new Map(counted.map((campaign) => [campaign.id, campaign.collectedAmount]));
  // withCountedCollectedAmount answers for every Campaign it was given, so the
  // 0 is only there for the type; were it ever used, the marker would be left
  // out, not shown with a made-up number.
  const auditMarkers = auditRows
    .map((row) => ({ ...row, gross: grossByCampaign.get(row.campaign.id) ?? 0 }))
    .filter((row) => row.gross > row.threshold);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Penanda Audit dan Donasi</h1>
        <p className="mt-1 text-sm text-gray-500">
          Catatan yang dipasang System saat sebuah Donation settle: Campaign yang akumulasi Gross-nya melewati ambang
          audit (Penanda Audit), dan satu Donation yang besarnya melewati ambang Donation tunggal (Penanda Donasi).
          Hanya untuk dibaca. Penanda tidak membekukan Campaign, tidak menahan Donation, dan tidak meminta tindakan
          apa pun. Terbaru lebih dulu, paling banyak {LIST_LIMIT} per daftar; yang lebih lama tetap tercatat.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Angka hanya memuat uang nyata: penanda yang berasal dari Donasi uji (Payment sandbox beta) tidak
          ditampilkan, dan Gross Campaign dihitung saat ini tanpa Donasi uji. Daftar ini tidak memuat data Donor.
          Ambang diatur di{' '}
          <Link href="/admin/abuse-thresholds" className={linkClass}>
            Ambang Penyalahgunaan
          </Link>
          .
        </p>
      </div>

      <section aria-labelledby="scrutiny-audit" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="scrutiny-audit" className="mb-3 text-lg font-semibold text-gray-900">
          Penanda Audit
        </h2>
        {auditMarkers.length === 0 ? (
          <p className="text-sm text-gray-500">Belum ada Penanda Audit.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Campaign
                  </th>
                  <th scope="col" className={th}>
                    Alasan
                  </th>
                  <th scope="col" className={th}>
                    Dipasang
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditMarkers.map((marker) => (
                  <tr key={marker.id}>
                    <td className={td}>
                      <CampaignLink campaign={marker.campaign} />
                    </td>
                    <td className={td}>
                      Akumulasi Gross {formatRupiah(marker.gross)} melewati ambang audit{' '}
                      {formatRupiah(marker.threshold)}.
                    </td>
                    <td className={td}>{formatWhen(marker.placedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="scrutiny-donation" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="scrutiny-donation" className="mb-3 text-lg font-semibold text-gray-900">
          Penanda Donasi
        </h2>
        {donationMarkers.length === 0 ? (
          <p className="text-sm text-gray-500">Belum ada Penanda Donasi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Campaign
                  </th>
                  <th scope="col" className={th}>
                    Donation
                  </th>
                  <th scope="col" className={th}>
                    Alasan
                  </th>
                  <th scope="col" className={th}>
                    Ditandai
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {donationMarkers.map((marker) => (
                  <tr key={marker.id}>
                    <td className={td}>
                      <CampaignLink campaign={marker.campaign} />
                    </td>
                    <td className={`${td} break-all font-mono text-xs`}>{marker.donationId}</td>
                    <td className={td}>
                      Satu Donation {formatRupiah(marker.amount)} melewati ambang Donation tunggal{' '}
                      {formatRupiah(marker.threshold)}.
                    </td>
                    <td className={td}>{formatWhen(marker.flaggedAt)}</td>
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
