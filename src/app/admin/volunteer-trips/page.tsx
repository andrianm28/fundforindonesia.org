import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { VolunteerTripStatus, VolunteerTripStatusChangeAction } from '@/generated/prisma/client';
import { AdminTripSuspensionAction } from '@/components/admin/AdminTripSuspensionAction';

// Rendered per request: Trips are suspended and lifted by other Admins.
export const dynamic = 'force-dynamic';

/**
 * The Admin page for Volunteer Trip Suspension (ticket 38; CONTEXT.md,
 * Suspension), following /admin/campaigns/lifecycle: Active Trips are
 * candidates to suspend, Suspended ones to lift. The rules (Admin only,
 * never your own Trip, the second pair of hands on a lift) live in
 * src/lib/volunteer/trip.ts and are re-checked there on every submit; what
 * this page reads (`fundraiserId`, the latest SUSPENDED log row's actor) is
 * only so the control can say why it is not offered.
 *
 * Access is the /admin layout's (the ADMIN assignment); the session is read
 * here only for the signed-in Admin's id.
 */

type TripRow = { id: string; slug: string; title: string; fundraiserId: string };

function TripTable({
  title,
  emptyMessage,
  trips,
  renderAction,
}: {
  title: string;
  emptyMessage: string;
  trips: readonly TripRow[];
  renderAction: (trip: TripRow) => React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Volunteer Trip
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {trips.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-6 py-8 text-center text-gray-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                trips.map((trip) => (
                  <tr key={trip.id} className="align-top hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{trip.title}</td>
                    <td className="px-6 py-4">{renderAction(trip)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default async function AdminVolunteerTripsPage() {
  const session = await getServerSession();
  const actorId = session!.user!.id as string;

  const select = { id: true, slug: true, title: true, fundraiserId: true } as const;
  const [active, suspended] = await Promise.all([
    prisma.volunteerTrip.findMany({
      where: { status: VolunteerTripStatus.ACTIVE },
      select,
      orderBy: { createdAt: 'asc' },
    }) as Promise<TripRow[]>,
    prisma.volunteerTrip.findMany({
      where: { status: VolunteerTripStatus.SUSPENDED },
      select,
      orderBy: { createdAt: 'asc' },
    }) as Promise<TripRow[]>,
  ]);

  // The Admin who imposed each current Suspension: the newest SUSPENDED log
  // row per Trip, the same row liftTripSuspension itself reads.
  const suspensions = suspended.length
    ? await prisma.volunteerTripStatusChange.findMany({
        where: { tripId: { in: suspended.map((t) => t.id) }, action: VolunteerTripStatusChangeAction.SUSPENDED },
        orderBy: { createdAt: 'desc' },
        select: { tripId: true, actorId: true },
      })
    : [];
  const suspendedBy = new Map<string, string | null>();
  for (const row of suspensions) {
    if (!suspendedBy.has(row.tripId)) suspendedBy.set(row.tripId, row.actorId);
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Penangguhan Volunteer Trip</h1>
        <p className="text-gray-600 mt-1">
          Admin menangguhkan Trip yang Aktif dengan alasan tercatat. Selama Suspended, tidak ada Registration baru dan
          tidak ada Payout Trip Fee; Registration yang sudah Confirmed tidak dibatalkan atau di-refund otomatis
          (pembatalan Batch tetap tindakan terpisah). Pencabutan harus dilakukan Admin lain.
        </p>
      </div>

      <TripTable
        title="Aktif (bisa ditangguhkan)"
        emptyMessage="Tidak ada Volunteer Trip Aktif."
        trips={active}
        renderAction={(trip) => (
          <AdminTripSuspensionAction
            tripId={trip.id}
            mode="suspend"
            isOwnTrip={trip.fundraiserId === actorId}
            suspendedBySameAdmin={false}
          />
        )}
      />

      <TripTable
        title="Ditangguhkan (bisa dicabut)"
        emptyMessage="Tidak ada Volunteer Trip yang ditangguhkan."
        trips={suspended}
        renderAction={(trip) => (
          <AdminTripSuspensionAction
            tripId={trip.id}
            mode="lift"
            isOwnTrip={trip.fundraiserId === actorId}
            suspendedBySameAdmin={suspendedBy.get(trip.id) === actorId}
          />
        )}
      />
    </div>
  );
}
