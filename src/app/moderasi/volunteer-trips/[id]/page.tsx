import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasAssignment } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatRupiah } from "@/lib/utils/currency";
import { TripDecisionPanel } from "./TripDecisionPanel";

// Reads the database: never served stale from a cache.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const formatDate = (date: Date) =>
  new Date(date).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

/**
 * One Submitted Volunteer Trip as the Verifier reviews it (ticket 34). A
 * Submitted Trip cannot be edited (only Draft and Rejected can), so what is
 * shown here is what a decision applies to. The "own Trip" note is a hint;
 * decideTripSubmission enforces the rule.
 */
export default async function ModerasiVolunteerTripPage({ params }: PageProps) {
  const session = await getServerSession();
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.VERIFIER)) {
    redirect("/");
  }

  const { id } = await params;
  const trip = await prisma.volunteerTrip.findUnique({
    where: { id },
    include: {
      fundraiser: { select: { name: true } },
      batches: { orderBy: { startDate: "asc" } },
    },
  });
  if (!trip) notFound();

  const isSubmitted = trip.status === "SUBMITTED";
  const isOwn = trip.fundraiserId === session.user.id;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-text">{trip.title}</h1>
        <p className="text-sm text-text-secondary mt-1">Fundraiser: {trip.fundraiser.name}</p>
      </div>

      <section className="bg-white rounded-xl border border-border p-6 space-y-4">
        <p className="text-xs text-text-secondary">
          Isi Trip ini tidak dapat diubah Fundraiser selama menunggu keputusan.
        </p>
        <dl className="space-y-3 text-sm text-[#424242]">
          <div>
            <dt className="text-xs text-text-secondary">Destinasi</dt>
            <dd>{trip.destination}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-secondary">Trip Fee</dt>
            <dd>{formatRupiah(trip.tripFeeAmount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-secondary">Deskripsi</dt>
            <dd className="whitespace-pre-wrap">{trip.description}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-secondary">Cerita</dt>
            <dd className="whitespace-pre-wrap">{trip.story}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-secondary">Itinerary</dt>
            <dd className="whitespace-pre-wrap">{trip.itinerary}</dd>
          </div>
        </dl>
      </section>

      <section className="bg-white rounded-xl border border-border p-6 space-y-2">
        <h2 className="text-sm font-semibold text-text">Volunteer Batch</h2>
        {trip.batches.length === 0 && <p className="text-sm text-text-secondary">Belum ada Batch.</p>}
        {trip.batches.map((batch) => (
          <p key={batch.id} className="text-sm text-[#424242]">
            {formatDate(batch.startDate)} sampai {formatDate(batch.endDate)} · pendaftaran sampai{" "}
            {formatDate(batch.registrationDeadline)} · kuota {batch.minQuota} sampai {batch.maxQuota}
          </p>
        ))}
      </section>

      <section className="bg-white rounded-xl border border-border p-6 space-y-3">
        <h2 className="text-sm font-semibold text-text">Keputusan</h2>
        {!isSubmitted ? (
          <p className="text-sm text-text-secondary">Trip ini tidak lagi menunggu keputusan.</p>
        ) : (
          <>
            {isOwn && (
              <p className="text-sm text-text-secondary">
                Ini Trip milik Anda sendiri; Verifier tidak dapat memutuskannya dan server akan menolak
                keputusan Anda.
              </p>
            )}
            <TripDecisionPanel tripId={trip.id} />
          </>
        )}
      </section>
    </div>
  );
}
