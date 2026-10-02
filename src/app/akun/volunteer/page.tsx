import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { listVolunteerRegistrations } from '@/lib/volunteer/registration-view';
import { REGISTRATION_STATUS_LABELS, REFUND_STATUS_LABELS } from '@/lib/volunteer/status-labels';
import { formatRupiah } from '@/lib/utils/currency';
import { formatWibDate } from '@/lib/volunteer/batch-dates';
import { HoldCountdown } from '@/app/volunteer-trip/_components/HoldCountdown';
import { CancelRegistrationButton } from '@/app/volunteer-trip/_components/CancelRegistrationButton';
import { ContinuePayment } from '@/app/volunteer-trip/_components/ContinuePayment';

/**
 * The Volunteer's dashboard (ticket 37): their own Registrations with status,
 * Refund status, the tiered cancel and the certificate link, and the Trips
 * they completed ("Catatan kontribusi", no impact figures: there is no source
 * for them). Not behind NEXT_PUBLIC_VOLUNTEER_ENABLED: someone who already
 * registered can always see their records. Everything user-controlled is
 * rendered as React text.
 */
export const dynamic = 'force-dynamic';

export default async function VolunteerDashboardPage() {
  const session = await getServerSession();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent('/akun/volunteer')}`);

  const { registrations, completed } = await listVolunteerRegistrations(prisma, {
    userId: session.user.id as string,
    now: new Date(),
  });

  return (
    <div className="max-w-xl mx-auto px-4 py-6 md:py-10 space-y-8">
      <h1 className="text-2xl font-bold text-text">Keikutsertaan Volunteer Saya</h1>

      <section aria-labelledby="registrations-heading" className="space-y-3">
        <h2 id="registrations-heading" className="text-lg font-semibold text-text">
          Registrasi
        </h2>
        {registrations.length === 0 && (
          <p className="text-sm text-text-secondary">Belum ada Registrasi Volunteer.</p>
        )}
        {registrations.map((r) => (
          <article key={r.id} className="rounded-lg border border-border p-4 space-y-2">
            <p className="font-medium text-text">{r.trip.title}</p>
            <p className="text-sm text-text-secondary">{r.trip.destination}</p>
            <p className="text-sm text-text-secondary">
              Batch {formatWibDate(r.batch.startDate)} - {formatWibDate(r.batch.endDate)}
            </p>
            <p className="text-sm">
              Status: <span className="font-medium text-text">{REGISTRATION_STATUS_LABELS[r.status]}</span>
            </p>
            {r.status === 'HOLD' && (
              <>
                <p className="text-sm text-text">
                  Kursi ditahan selama <HoldCountdown expiresAt={r.holdExpiresAt.toISOString()} />.
                </p>
                <ContinuePayment instructions={r.paymentInstructions} />
              </>
            )}
            {r.refunds.length > 0 && (
              <ul className="space-y-1">
                {r.refunds.map((refund) => (
                  <li key={refund.id} className="text-sm text-text">
                    Refund {formatRupiah(refund.amount)} - {REFUND_STATUS_LABELS[refund.status] ?? refund.status}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/volunteer-trip/registrasi/${r.id}`} className="text-primary font-medium text-sm">
                Lihat detail
              </Link>
              {r.certificateCode && (
                <Link href={`/sertifikat/${r.certificateCode}`} className="text-primary font-medium text-sm">
                  Lihat sertifikat
                </Link>
              )}
            </div>
            {(r.status === 'HOLD' || r.status === 'CONFIRMED') && (
              <CancelRegistrationButton
                registrationId={r.id}
                paid={r.status === 'CONFIRMED'}
                refundAmount={r.cancelRefundAmount}
              />
            )}
          </article>
        ))}
      </section>

      <section aria-labelledby="contribution-heading" className="space-y-3">
        <h2 id="contribution-heading" className="text-lg font-semibold text-text">
          Catatan kontribusi
        </h2>
        {completed.length === 0 ? (
          <p className="text-sm text-text-secondary">Belum ada Trip yang selesai diikuti.</p>
        ) : (
          <ul className="space-y-2">
            {completed.map((trip) => (
              <li key={trip.registrationId} className="rounded-lg border border-border p-3">
                <p className="font-medium text-text">{trip.title}</p>
                <p className="text-sm text-text-secondary">{trip.destination}</p>
                <p className="text-sm text-text-secondary">
                  {formatWibDate(trip.startDate)} - {formatWibDate(trip.endDate)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
