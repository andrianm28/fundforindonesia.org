import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatRupiah } from "@/lib/utils/currency";

// Reads the database with no request data of its own: force-dynamic so the
// queue is never served stale from a cache.
export const dynamic = "force-dynamic";

/**
 * The Verifier's queue of Submitted Volunteer Trips (ticket 34), oldest
 * first, the same order as GET /api/moderasi/volunteer-trips.
 */
export default async function ModerasiVolunteerTripsPage() {
  const session = await getServerSession();
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }

  const trips = await prisma.volunteerTrip.findMany({
    where: { status: "SUBMITTED" },
    select: {
      id: true,
      title: true,
      destination: true,
      tripFeeAmount: true,
      createdAt: true,
      fundraiser: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-[#212121]">Volunteer Trip Menunggu Review</h1>
      <p className="text-sm text-[#757575] mt-1">Diurutkan dari yang paling lama menunggu.</p>

      <div className="mt-6 space-y-3">
        {trips.length === 0 && (
          <div className="bg-white rounded-xl border border-[#E0E0E0] p-8 text-center text-sm text-[#757575]">
            Tidak ada Volunteer Trip yang menunggu review.
          </div>
        )}
        {trips.map((trip) => (
          <Link
            key={trip.id}
            href={`/moderasi/volunteer-trips/${trip.id}`}
            className="block bg-white rounded-xl border border-[#E0E0E0] p-4 hover:border-[#0073E6] transition-colors"
          >
            <p className="text-sm font-medium text-[#212121]">{trip.title}</p>
            <p className="text-xs text-[#757575] mt-1">
              Fundraiser: {trip.fundraiser.name} · {trip.destination}
            </p>
            <p className="text-xs text-[#757575]">
              Trip Fee {formatRupiah(trip.tripFeeAmount)} · diajukan{" "}
              {new Date(trip.createdAt).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
