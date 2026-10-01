import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { TripForm } from '../_components/TripForm';

/** A new Draft Volunteer Trip (ticket 35). Reads no data: the form posts to the API. */
export default async function NewTripPage() {
  const session = await getServerSession();
  if (!session?.user) redirect('/login');

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <Link href="/akun/volunteer-trip" className="text-sm text-[#0073E6]">
        Kembali
      </Link>
      <h1 className="text-xl font-semibold text-[#212121]">Buat Volunteer Trip</h1>
      <TripForm />
    </div>
  );
}
