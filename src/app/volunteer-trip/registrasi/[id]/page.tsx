import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { REGISTRATION_STATUS_LABELS, REFUND_STATUS_LABELS } from '@/lib/volunteer/status-labels';
import { getVolunteerRegistration } from '@/lib/volunteer/registration-view';
import { formatRupiah } from '@/lib/utils/currency';
import { formatWibDate } from '@/lib/volunteer/batch-dates';
import { HoldCountdown } from '../../_components/HoldCountdown';
import { CancelRegistrationButton } from '../../_components/CancelRegistrationButton';
import { ContinuePayment } from '../../_components/ContinuePayment';

/**
 * One of the signed-in Volunteer's own Registrations (ticket 36): its status,
 * the seat-hold countdown while it is a HOLD, the confirmation once the Trip
 * Fee settled, its Refunds, and the cancel button with the tiered amount shown
 * first. Not behind NEXT_PUBLIC_VOLUNTEER_ENABLED: a Volunteer who already
 * registered can always see and cancel theirs. Another Volunteer's id is 404.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RegistrationPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/volunteer-trip/registrasi/${id}`)}`);

  const view = await getVolunteerRegistration(prisma, {
    registrationId: id,
    userId: session.user.id as string,
    now: new Date(),
  });
  if (!view) notFound();

  const cancellable = view.status === 'HOLD' || view.status === 'CONFIRMED';

  return (
    <article className="max-w-xl mx-auto px-4 py-6 md:py-10 space-y-5">
      <h1 className="text-2xl font-bold text-text">
        {view.status === 'CONFIRMED' ? 'Registrasi Terkonfirmasi' : 'Registrasi'}
      </h1>
      <section className="rounded-lg border border-border p-4 space-y-1">
        <p className="font-medium text-text">{view.trip.title}</p>
        <p className="text-sm text-text-secondary">{view.trip.destination}</p>
        <p className="text-sm text-text-secondary">
          Batch {formatWibDate(view.batch.startDate)} - {formatWibDate(view.batch.endDate)}
        </p>
        <p className="text-sm text-text-secondary">Trip Fee {formatRupiah(view.tripFee)}</p>
        <p className="text-sm">
          Status: <span className="font-medium text-text">{REGISTRATION_STATUS_LABELS[view.status]}</span>
        </p>
      </section>

      {view.status === 'HOLD' && (
        <p className="text-sm text-text">
          Kursi Anda ditahan selama <HoldCountdown expiresAt={view.holdExpiresAt.toISOString()} />. Halaman ini
          diperbarui otomatis begitu pembayaran Trip Fee kami terima.
        </p>
      )}
      {view.status === 'HOLD' && <ContinuePayment instructions={view.paymentInstructions} />}
      {view.status === 'CONFIRMED' && (
        <p className="text-sm text-text">
          Pembayaran Trip Fee {formatRupiah(view.paidAmount ?? view.tripFee)} sudah kami terima dan kursi Anda
          dipastikan.
        </p>
      )}
      {view.certificateCode && (
        <Link href={`/sertifikat/${view.certificateCode}`} className="inline-block text-primary font-medium text-sm">
          Lihat sertifikat
        </Link>
      )}
      {view.status === 'EXPIRED' && (
        <p className="text-sm text-text-secondary">
          Waktu penahanan kursi habis dan kursi dilepas. Jika Anda sempat membayar, Trip Fee dikembalikan penuh
          secara otomatis.
        </p>
      )}

      <section aria-labelledby="refund-heading">
        <h2 id="refund-heading" className="text-lg font-semibold text-text mb-2">
          Refund
        </h2>
        {view.refunds.length === 0 ? (
          <p className="text-sm text-text-secondary">Belum ada Refund.</p>
        ) : (
          <ul className="space-y-2">
            {view.refunds.map((refund) => (
              <li key={refund.id} className="text-sm text-text">
                {formatRupiah(refund.amount)} - {REFUND_STATUS_LABELS[refund.status] ?? refund.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      {cancellable && (
        <CancelRegistrationButton
          registrationId={view.id}
          paid={view.status === 'CONFIRMED'}
          refundAmount={view.cancelRefundAmount}
        />
      )}

      <Link href={`/volunteer-trip/${view.trip.slug}`} className="text-primary font-medium text-sm">
        Kembali ke Trip
      </Link>
    </article>
  );
}
