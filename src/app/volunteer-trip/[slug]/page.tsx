import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getTripDetail } from '@/lib/volunteer/catalog';
import { LazyImage } from '@/components/ui/LazyImage';
import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';

/**
 * A Volunteer Trip's public page (ticket 33), the route decideTripSubmission's
 * notification links to. Only an ACTIVE Trip renders; any other status is a
 * 404 for everyone. Rendered per request: seats left and deadlines move, and
 * the page reads the session to offer a signed-out visitor the sign-in page.
 *
 * The Batch picker shows no "Daftar" button yet: the Registration flow is
 * ticket 36, and a button into nothing would lie.
 */
export const dynamic = 'force-dynamic';

interface TripDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: TripDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const trip = await getTripDetail(prisma, slug, new Date());
  if (!trip) return { title: 'Volunteer Trip Tidak Ditemukan' };
  return { title: `${trip.title} - Fund for Indonesia`, description: trip.description };
}

const AVAILABILITY_LABEL = { FULL: 'Penuh', CLOSED: 'Pendaftaran ditutup' } as const;

export default async function TripDetailPage({ params }: TripDetailPageProps) {
  const { slug } = await params;
  const trip = await getTripDetail(prisma, slug, new Date());
  if (!trip) notFound();

  const session = await getServerSession();
  const loginHref = `/login?callbackUrl=${encodeURIComponent(`/volunteer-trip/${trip.slug}`)}`;

  return (
    <article className="max-w-3xl mx-auto px-4 py-6 md:py-10">
      <LazyImage src={trip.coverImage} alt={trip.title} width={800} height={450} className="w-full h-auto rounded-lg mb-4" />
      <h1 className="text-2xl font-bold text-text mb-1">{trip.title}</h1>
      <p className="text-text-secondary mb-1">{trip.destination}</p>
      <p className="text-text-secondary mb-4">{trip.description}</p>
      <p className="mb-6">
        <span className="text-sm text-text-secondary">Trip Fee </span>
        <span className="font-bold text-primary">{formatRupiah(trip.tripFeeAmount)}</span>
      </p>

      <section className="mb-6" aria-labelledby="itinerary">
        <h2 id="itinerary" className="text-lg font-semibold text-text mb-2">Itinerary</h2>
        <p className="whitespace-pre-line text-text-secondary">{trip.itinerary}</p>
      </section>

      <section className="mb-6" aria-labelledby="story">
        <h2 id="story" className="text-lg font-semibold text-text mb-2">Cerita</h2>
        <p className="whitespace-pre-line text-text-secondary">{trip.story}</p>
      </section>

      <section aria-labelledby="batches">
        <h2 id="batches" className="text-lg font-semibold text-text mb-2">Pilih Batch</h2>
        {trip.batches.length === 0 ? (
          <p className="text-text-secondary">Belum ada Batch.</p>
        ) : (
          <ul className="space-y-3">
            {trip.batches.map((batch) => (
              <li key={batch.id} className="rounded-lg border border-border p-4">
                <p className="font-medium text-text">
                  {formatIndonesianDate(batch.startDate)} - {formatIndonesianDate(batch.endDate)}
                </p>
                {batch.availability === 'OPEN' ? (
                  <p className="text-sm text-text-secondary">
                    {`${batch.seatsLeft} dari ${batch.maxQuota} kursi tersisa`}
                  </p>
                ) : (
                  <p className="text-sm font-medium text-text">{AVAILABILITY_LABEL[batch.availability]}</p>
                )}
                <p className="text-sm text-text-secondary">
                  Tenggat pendaftaran {formatIndonesianDate(batch.registrationDeadline)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!session?.user && (
        <p className="mt-6 text-sm text-text-secondary">
          Sudah punya akun?{' '}
          <Link href={loginHref} className="text-primary font-medium">
            Masuk
          </Link>
        </p>
      )}
    </article>
  );
}
