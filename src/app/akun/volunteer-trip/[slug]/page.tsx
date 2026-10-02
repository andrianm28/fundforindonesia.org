import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getFundraiserTripDetail } from '@/lib/volunteer/fundraiser';
import { toWibDate } from '@/lib/volunteer/batch-dates';
import { BATCH_STATUS_LABELS, TRIP_STATUS_LABELS } from '@/lib/volunteer/status-labels';
import { formatRupiah } from '@/lib/utils/currency';
import { formatWibDate } from '@/lib/volunteer/refund-table';
import { BatchActions } from '../_components/BatchActions';
import { BatchForm } from '../_components/BatchForm';
import { SubmitTripButton } from '../_components/SubmitTripButton';
import { TripForm } from '../_components/TripForm';

// Reads the database: never served stale from a cache.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * One of the Fundraiser's own Volunteer Trips (ticket 35): its status and,
 * while Rejected, the Verifier's reason; the form while it is still Draft or
 * Rejected; and its Batches with their actions. Someone else's Trip is a 404.
 * What each button may do is the server's judgement (submitTrip, editBatch,
 * cancelBatch, completeBatch); the page only decides what to offer.
 */
export default async function FundraiserTripPage({ params }: PageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect('/login');

  const { slug } = await params;
  const trip = await getFundraiserTripDetail(prisma, session.user.id, slug, new Date());
  if (!trip) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Link href="/akun/volunteer-trip" className="text-sm text-[#0073E6]">
        Kembali
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-[#212121]">{trip.title}</h1>
        <p className="text-sm text-[#757575] mt-1">
          Status: {TRIP_STATUS_LABELS[trip.status] ?? trip.status} · {trip.destination} ·{' '}
          {formatRupiah(trip.tripFeeAmount)}
        </p>
      </div>

      {trip.rejectionReason && (
        <section className="rounded-xl border border-[#C62828] bg-white p-4 space-y-1">
          <h2 className="text-sm font-semibold text-[#C62828]">Alasan penolakan</h2>
          {/* The Verifier wrote this freely: plain text, never markup. */}
          <p className="text-sm text-[#424242] whitespace-pre-wrap">{trip.rejectionReason}</p>
        </section>
      )}

      {trip.editable ? (
        <section className="bg-white rounded-xl border border-[#E0E0E0] p-6 space-y-4">
          <h2 className="text-sm font-semibold text-[#212121]">Isi Trip</h2>
          <TripForm
            slug={trip.slug}
            initial={{
              title: trip.title,
              description: trip.description,
              story: trip.story,
              coverImage: trip.coverImage,
              destination: trip.destination,
              itinerary: trip.itinerary,
              tripFeeAmount: trip.tripFeeAmount,
            }}
          />
          <div className="border-t border-[#E0E0E0] pt-4">
            <SubmitTripButton slug={trip.slug} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-[#757575]">
          Isi Trip hanya bisa diubah selama Draf atau Ditolak.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#212121]">Volunteer Batch</h2>
        {trip.batches.length === 0 && <p className="text-sm text-[#757575]">Belum ada Batch.</p>}
        {trip.batches.map((batch) => (
          <div key={batch.id} className="bg-white rounded-xl border border-[#E0E0E0] p-4 space-y-3">
            <p className="text-sm text-[#424242]">
              {formatWibDate(batch.startDate)} sampai {formatWibDate(batch.endDate)} · pendaftaran
              sampai {formatWibDate(batch.registrationDeadline)} · kuota {batch.minQuota} sampai{' '}
              {batch.maxQuota} · {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
            </p>
            {batch.status === 'OPEN' && (
              <BatchActions
                slug={trip.slug}
                batchId={batch.id}
                ended={batch.ended}
                roster={batch.roster.map((r) => ({ id: r.id, name: r.name }))}
                values={{
                  startDate: toWibDate(batch.startDate),
                  endDate: toWibDate(batch.endDate),
                  registrationDeadline: toWibDate(batch.registrationDeadline),
                  maxQuota: batch.maxQuota,
                  minQuota: batch.minQuota,
                }}
              />
            )}
            {batch.status === 'COMPLETED' && (
              <p className="text-sm text-[#757575]">
                {batch.roster.filter((r) => r.attended).length} dari {batch.roster.length} Volunteer hadir.
              </p>
            )}
          </div>
        ))}
      </section>

      {/* Dates are WIB calendar dates; a Trip in any status but Ditarik or Selesai takes new Batches. */}
      {trip.status !== 'CANCELLED' && trip.status !== 'COMPLETED' && (
        <section className="bg-white rounded-xl border border-[#E0E0E0] p-6 space-y-3">
          <h2 className="text-sm font-semibold text-[#212121]">Tambah Batch</h2>
          <BatchForm slug={trip.slug} />
        </section>
      )}
    </div>
  );
}
