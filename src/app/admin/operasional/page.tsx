import { prisma } from '@/lib/prisma';
import { donationsEnabled } from '@/lib/donations';
import { resolveOperations, type OperationsHistoryEntry } from '@/lib/operations';
import { AdminOperationsForm } from '@/components/admin/AdminOperationsForm';
import { AdminZakatSettingsForm } from '@/components/admin/AdminZakatSettingsForm';

export const dynamic = 'force-dynamic';

/**
 * Pengaturan Operasional (src/lib/operations.ts, PKS ticket 01): the donation
 * switch, maintenance mode and donation presets, changed by an Admin without a rebuild. The form
 * posts to POST /api/admin/operations. Admin only: the
 * Admin layout answers anyone else with the same 404 as a missing page.
 */

const FIELD_LABEL: Record<OperationsHistoryEntry['changes'][number]['field'], string> = {
  donationsOpen: 'Terima donasi',
  maintenanceOn: 'Mode pemeliharaan',
  maintenanceMessage: 'Pesan pemeliharaan',
  donationPresets: 'Preset nominal donasi',
  zakatEnabled: 'Modul zakat',
  zakatNisabAmount: 'Nisab zakat (Rp)',
  zakatRecipientOrganisationId: 'Lembaga penerima zakat (ID)',
};

function show(field: OperationsHistoryEntry['changes'][number]['field'], v: boolean | string | number | number[] | null): string {
  if (v === null) return '(kosong)';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') return String(v);
  if (field === 'maintenanceMessage') return v === '' ? '(kosong)' : `"${String(v)}"`;
  return v ? 'hidup' : 'mati';
}

export default async function AdminOperationsPage() {
  const operations = await resolveOperations(prisma);
  const organisations = await prisma.partnerOrganisation.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Pengaturan Operasional</h1>
        <p className="mt-1 text-gray-600">Saklar darurat yang berlaku saat itu juga, tanpa build ulang.</p>
      </div>

      {!donationsEnabled() && (
        <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Donasi tetap tertutup karena NEXT_PUBLIC_DONATIONS_ENABLED di lingkungan ini bukan <code>true</code>. Saklar
          di bawah hanya bisa menutup, tidak bisa membuka gerbang yang ditutup lingkungan.
        </p>
      )}

      <AdminOperationsForm
        initial={{
          donationsOpen: operations.donationsOpen,
          maintenanceOn: operations.maintenance.on,
          maintenanceMessage: operations.maintenance.message,
          donationPresets: operations.donationPresets,
        }}
      />

      <AdminZakatSettingsForm initial={operations.zakat} organisations={organisations} />

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Riwayat perubahan</h2>
        {operations.history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">Belum ada perubahan.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {operations.history.map((entry) => (
              <li key={entry.at + entry.actorId} className="text-sm text-gray-800">
                <span className="font-medium">{entry.actorName}</span>,{' '}
                {new Date(entry.at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' })} WIB
                <ul className="mt-1 list-disc pl-5 text-gray-600">
                  {entry.changes.map((c) => (
                    <li key={c.field}>
                      {FIELD_LABEL[c.field]}: {show(c.field, c.from)} → {show(c.field, c.to)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
