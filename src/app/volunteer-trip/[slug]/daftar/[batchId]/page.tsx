import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getTripDetail } from '@/lib/volunteer/catalog';
import { findOwnLiveRegistration } from '@/lib/volunteer/registration-view';
import { volunteerRegistrationEnabled, VOLUNTEER_DISABLED_MESSAGE } from '@/lib/volunteer/registration-flag';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';
import { registrationMethodFor } from '@/lib/volunteer/payment-method';
import { formatRupiah } from '@/lib/utils/currency';
import { formatWibDate } from '@/lib/volunteer/batch-dates';
import { RefundTierTable } from '../../../_components/RefundTierTable';
import { RegisterButton } from '../../../_components/RegisterButton';

/**
 * The Registration summary (ticket 36): Trip, Batch, dates, Trip Fee and the
 * tiered Refund table with this Batch's real dates, all BEFORE the Volunteer
 * pays. Reads the database and the session, so rendered per request. Behind
 * NEXT_PUBLIC_VOLUNTEER_ENABLED: while it is off, the page says so and reads
 * nothing; POST .../registrations refuses on the server regardless.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string; batchId: string }>;
}

/**
 * The Registration method the active provider charges, as the donation route
 * checks it: a provider charges one method, so offering another would only
 * lead to a 503. Only an unconfigured provider falls back to QRIS (the API
 * refuses the Registration on its own in that case); a method or provider the
 * app does not know is a bug and is thrown, never shown as QRIS.
 */
function paymentMethodOfActiveProvider() {
  try {
    return registrationMethodFor(getPaymentProvider().method);
  } catch (error) {
    if (error instanceof PaymentProviderNotConfiguredError) return 'qris' as const;
    throw error;
  }
}

export default async function RegistrationSummaryPage({ params }: PageProps) {
  const { slug, batchId } = await params;

  if (!volunteerRegistrationEnabled()) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 text-center space-y-3">
        <p className="text-text-secondary">{VOLUNTEER_DISABLED_MESSAGE}</p>
        <Link href={`/volunteer-trip/${slug}`} className="text-primary font-medium">
          Kembali ke Trip
        </Link>
      </div>
    );
  }

  const session = await getServerSession();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/volunteer-trip/${slug}/daftar/${batchId}`)}`);
  }

  const trip = await getTripDetail(prisma, slug, new Date());
  const batch = trip?.batches.find((b) => b.id === batchId);
  if (!trip || !batch) notFound();

  const existing = await findOwnLiveRegistration(prisma, {
    batchId: batch.id,
    userId: session.user.id as string,
    now: new Date(),
  });

  return (
    <article className="max-w-xl mx-auto px-4 py-6 md:py-10 space-y-5">
      <h1 className="text-2xl font-bold text-text">Ringkasan Registrasi</h1>
      <section className="rounded-lg border border-border p-4 space-y-1">
        <p className="font-medium text-text">{trip.title}</p>
        <p className="text-sm text-text-secondary">{trip.destination}</p>
        <p className="text-sm text-text-secondary">
          Batch {formatWibDate(batch.startDate)} - {formatWibDate(batch.endDate)}
        </p>
        <p className="text-sm text-text-secondary">
          Tenggat pendaftaran {formatWibDate(batch.registrationDeadline)}
        </p>
        <p>
          <span className="text-sm text-text-secondary">Trip Fee </span>
          <span className="font-bold text-primary">{formatRupiah(trip.tripFeeAmount)}</span>
        </p>
      </section>

      <RefundTierTable startDate={batch.startDate.toISOString()} tripFee={trip.tripFeeAmount} />

      {existing ? (
        <p className="text-sm text-text">
          Anda sudah punya Registrasi {existing.status === 'HOLD' ? 'yang menunggu pembayaran' : 'terkonfirmasi'} di
          Batch ini.{' '}
          <Link href={`/volunteer-trip/registrasi/${existing.id}`} className="text-primary font-medium">
            Lihat Registrasi
          </Link>
        </p>
      ) : batch.availability === 'OPEN' ? (
        <>
          <p className="text-sm text-text-secondary">
            Setelah Anda mendaftar, kursi ditahan selama 30 menit sementara Anda membayar Trip Fee. Jika pembayaran
            tidak selesai dalam waktu itu, kursi dilepas.
          </p>
          <RegisterButton
            slug={trip.slug}
            batchId={batch.id}
            paymentMethod={paymentMethodOfActiveProvider()}
          />
        </>
      ) : (
        <p className="text-sm font-medium text-text">
          {batch.availability === 'FULL' ? 'Batch ini sudah penuh.' : 'Pendaftaran Batch ini sudah ditutup.'}
        </p>
      )}
    </article>
  );
}
