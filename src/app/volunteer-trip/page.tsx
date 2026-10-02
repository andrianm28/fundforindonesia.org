import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { listCatalogTrips } from '@/lib/volunteer/catalog';
import { LazyImage } from '@/components/ui/LazyImage';
import { formatRupiah } from '@/lib/utils/currency';
import { formatWibDate } from '@/lib/volunteer/batch-dates';

/**
 * The public Volunteer Trip catalog (ticket 33): ACTIVE Trips with at least
 * one OPEN Batch still before its registration deadline. Rendered per
 * request, not prerendered: the Docker build has no database, and seats and
 * deadlines move.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Volunteer Trip - Fund for Indonesia',
  description: 'Ikut perjalanan relawan ke seluruh Indonesia. Pilih Trip, lihat jadwal Batch, dan cek kursi yang tersisa.',
};

export default async function VolunteerCatalogPage() {
  const trips = await listCatalogTrips(prisma, new Date());

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">
      <h1 className="text-2xl font-bold text-text mb-2">Volunteer Trip</h1>
      <p className="text-text-secondary mb-6">Perjalanan relawan yang sedang membuka pendaftaran.</p>

      {trips.length === 0 ? (
        <p className="text-text-secondary">Belum ada Volunteer Trip yang membuka pendaftaran.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {trips.map((trip) => (
            <li key={trip.slug}>
              <Link
                href={`/volunteer-trip/${trip.slug}`}
                className="block rounded-lg border border-border overflow-hidden bg-surface hover:shadow-md transition-shadow"
              >
                <LazyImage src={trip.coverImage} alt={trip.title} width={400} height={225} className="w-full h-auto" />
                <div className="p-4">
                  <h2 className="font-semibold text-text mb-1">{trip.title}</h2>
                  <p className="text-sm text-text-secondary">{trip.destination}</p>
                  <p className="text-sm text-text-secondary mt-2">
                    Batch terdekat: {formatWibDate(trip.nearestBatchStart)}
                  </p>
                  <p className="font-bold text-primary mt-2">{formatRupiah(trip.tripFeeAmount)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
