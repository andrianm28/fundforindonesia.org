import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listFundraiserTrips } from '@/lib/volunteer/fundraiser';
import { TRIP_STATUS_LABELS } from '@/lib/volunteer/status-labels';

// Reads the database: never served stale from a cache.
export const dynamic = 'force-dynamic';

/**
 * The Fundraiser's Volunteer Trips in every status (ticket 35). Anyone
 * registered may have Trips (PRD FFI-04), so no assignment is asked for; the
 * list is only ever the caller's own. Not behind NEXT_PUBLIC_VOLUNTEER_ENABLED,
 * which gates only the Volunteer's registration flow.
 */
export default async function FundraiserTripsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect('/login');

  const trips = await listFundraiserTrips(prisma, session.user.id);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[#212121]">Volunteer Trip Saya</h1>
        <Link
          href="/akun/volunteer-trip/baru"
          className="px-4 py-2 bg-[#0073E6] text-white text-sm font-medium rounded-lg"
        >
          Buat Trip
        </Link>
      </div>
      {trips.length === 0 ? (
        <p className="text-sm text-[#757575]">Anda belum membuat Volunteer Trip.</p>
      ) : (
        <ul className="space-y-3">
          {trips.map((trip) => (
            <li key={trip.slug} className="bg-white rounded-xl border border-[#E0E0E0] p-4">
              <Link href={`/akun/volunteer-trip/${trip.slug}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-medium text-[#212121]">{trip.title}</h2>
                  <span className="text-xs font-medium text-[#424242] bg-[#F5F5F5] rounded-full px-2 py-0.5">
                    {TRIP_STATUS_LABELS[trip.status] ?? trip.status}
                  </span>
                </div>
                <p className="text-xs text-[#757575] mt-1">
                  {trip.destination} · {trip.batchCount} Batch
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
