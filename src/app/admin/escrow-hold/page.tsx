import { prisma } from '@/lib/prisma';
import { AdminEscrowHoldForm } from '@/components/admin/AdminEscrowHoldForm';
import { ESCROW_HOLD_DAYS } from '@/lib/money/escrow';
import { MAX_ESCROW_HOLD_DAYS, MIN_ESCROW_HOLD_DAYS } from '@/lib/money/escrow-hold-config';

export const dynamic = 'force-dynamic';

/**
 * Ticket 90 (plan A-7): shows the Escrow Hold length in force and its history,
 * and sets it through POST /api/admin/escrow-hold (AdminEscrowHoldForm).
 * CONTEXT.md, Escrow Hold; src/lib/money/escrow-hold-config.ts.
 *
 * Rows are append-only, so the newest row per scope and key is the one in
 * force (the rule resolveEscrowHoldDays applies), and setBy/setAt on it are
 * the "who and when". With no default row the length is the ESCROW_HOLD_DAYS
 * fallback, which the page labels as such rather than as an Admin choice.
 */

function formatWhen(at: Date): string {
  return (
    new Date(at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB'
  );
}

export default async function AdminEscrowHoldPage() {
  const rows = await prisma.escrowHoldSetting.findMany({
    orderBy: { setAt: 'desc' },
    include: { setBy: { select: { name: true } } },
  });

  // First row met per key, in newest-first order, is the one in force.
  const currentDefault = rows.find((row) => row.scope === 'DEFAULT') ?? null;
  const byCategory = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.scope === 'CATEGORY' && row.category && !byCategory.has(row.category)) byCategory.set(row.category, row);
  }

  const th = 'px-3 py-2 text-left text-xs font-semibold text-gray-500';
  const td = 'px-3 py-2 text-sm text-gray-800';

  function changedBy(row: { setBy?: { name: string } | null; setAt: Date }) {
    return `${row.setBy?.name ?? 'Admin'}, ${formatWhen(row.setAt)}`;
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Escrow Hold</h1>
        <p className="mt-1 text-sm text-gray-500">
          Lama dana donasi ditahan sebelum bisa dicairkan Campaign. Diatur sebagai default dengan override per
          Category (misalnya bencana dipendekkan). Setiap perubahan tersimpan sebagai baris baru; Payment yang sudah
          dibuat tetap memakai lama tahan yang berlaku saat itu.
        </p>
      </div>

      <section aria-labelledby="hold-current" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="hold-current" className="mb-3 text-lg font-semibold text-gray-900">
          Lama yang berlaku
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Berlaku untuk</th>
                <th className={th}>Lama</th>
                <th className={th}>Terakhir diubah</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className={td}>Default (semua Category dan Trip Fee)</td>
                <td className={td}>
                  {currentDefault ? `${currentDefault.days} hari` : `${ESCROW_HOLD_DAYS} hari (bawaan, belum diatur)`}
                </td>
                <td className={td}>{currentDefault ? changedBy(currentDefault) : '-'}</td>
              </tr>
              {[...byCategory.values()].map((row) => (
                <tr key={`cat-${row.category}`}>
                  <td className={td}>
                    Category: <span>{row.category}</span>
                  </td>
                  <td className={td}>{row.days} hari</td>
                  <td className={td}>{changedBy(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Urutan yang dipakai untuk satu Campaign: override Category, lalu default. Batas {MIN_ESCROW_HOLD_DAYS} sampai{' '}
          {MAX_ESCROW_HOLD_DAYS} hari.
        </p>
      </section>

      <section aria-labelledby="hold-form" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="hold-form" className="mb-3 text-lg font-semibold text-gray-900">
          Ubah lama tahan
        </h2>
        <AdminEscrowHoldForm />
      </section>

      <section aria-labelledby="hold-history" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="hold-history" className="mb-3 text-lg font-semibold text-gray-900">
          Riwayat perubahan
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">Belum ada perubahan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Waktu</th>
                  <th className={th}>Yang diubah</th>
                  <th className={th}>Lama</th>
                  <th className={th}>Oleh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className={td}>{formatWhen(row.setAt)}</td>
                    <td className={td}>{row.scope === 'DEFAULT' ? 'Default' : `Category ${row.category}`}</td>
                    <td className={td}>{row.days} hari</td>
                    <td className={td}>{row.setBy?.name ?? 'Admin'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
