import { listFailedNotifications } from '@/lib/failed-notifications';
import { MAX_NOTIFICATION_ATTEMPTS } from '@/lib/mail/failed-queue';
import { AdminResendNotificationButton } from '@/components/admin/AdminResendNotificationButton';

export const dynamic = 'force-dynamic';

/**
 * The failed notification queue (PKS Pasal 8(2)): emails the provider refused,
 * still being retried by the scheduled jobs or out of attempts, with a button to
 * send one again. Access is the /admin layout's ADMIN check, which answers
 * anyone else with a 404; the resend itself is POST
 * /api/admin/failed-notifications/[id]/resend, which does the same.
 *
 * Shows what an Admin needs to find the person and the cause (kind, the ids of
 * the subject, the attempts, the redacted error) and nothing that identifies
 * them: no address, no body. Runbook: docs/runbooks/insiden.md.
 */

const KIND_LABEL: Record<string, string> = {
  receipt: 'Bukti donasi',
  receipt_resend: 'Kirim ulang bukti donasi',
  campaign_update: 'Kabar terbaru Campaign',
  campaign_deadline_reminder: 'Pengingat tenggat Campaign',
  kind_authorisation_expiry_warning: 'Peringatan izin Kind hampir habis',
  partnership_inquiry: 'Partnership Inquiry (ke tim)',
  partnership_inquiry_confirmation: 'Konfirmasi Partnership Inquiry',
  organisation_invitation: 'Undangan anggota tim',
  registration_confirmed: 'Konfirmasi pendaftaran Trip',
  trip_fee_refund_approved: 'Refund Trip Fee disetujui',
};

function formatWhen(at: Date): string {
  return at.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB';
}

/** The ids of a row's context as "key: value" pairs; a corrupt value shows as it is rather than hiding the row. */
function contextText(context: string): string {
  try {
    const parsed = JSON.parse(context) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');
  } catch {
    return context;
  }
}

const th = 'px-3 py-2 text-left text-xs font-semibold text-gray-500';
const td = 'px-3 py-2 text-sm text-gray-800 align-top';

export default async function AdminFailedNotificationsPage() {
  const { rows, counts } = await listFailedNotifications();

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notifikasi gagal</h1>
        <p className="mt-1 text-sm text-gray-500">
          Email yang ditolak penyedia email. Job terjadwal mencoba lagi sampai {MAX_NOTIFICATION_ATTEMPTS} kali dengan
          jeda yang makin panjang; sesudah itu statusnya gagal permanen dan hanya terkirim bila Admin menekan kirim
          ulang. Isi email dan alamat penerima tidak ditampilkan; cari orangnya lewat ID di kolom Rujukan.
        </p>
      </div>

      <section aria-labelledby="nq-summary" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="nq-summary" className="mb-2 text-lg font-semibold text-gray-900">
          Ringkasan
        </h2>
        {counts.pending + counts.dead === 0 ? (
          <p className="text-sm text-green-700">Antrean kosong. Semua email terkirim.</p>
        ) : (
          <p className="text-sm font-semibold text-red-700">
            {counts.dead} gagal permanen, {counts.pending} masih dicoba ulang.
          </p>
        )}
      </section>

      <section aria-labelledby="nq-list" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="nq-list" className="mb-3 text-lg font-semibold text-gray-900">
          Antrean
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">Tidak ada notifikasi yang menunggu.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Gagal pertama</th>
                  <th className={th}>Jenis</th>
                  <th className={th}>Rujukan</th>
                  <th className={th}>Status</th>
                  <th className={th}>Percobaan</th>
                  <th className={th}>Galat terakhir</th>
                  <th className={th}>Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className={td}>{formatWhen(row.createdAt)}</td>
                    <td className={td}>
                      {KIND_LABEL[row.kind] ?? row.kind} <span className="text-xs text-gray-400">({row.kind})</span>
                    </td>
                    <td className={td}>{contextText(row.context)}</td>
                    <td className={td}>
                      {row.status === 'DEAD' ? (
                        <span className="inline-block rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                          Gagal permanen
                        </span>
                      ) : (
                        <span className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Dicoba lagi {formatWhen(row.nextAttemptAt)}
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      {row.attempts} / {MAX_NOTIFICATION_ATTEMPTS}
                    </td>
                    <td className={td}>{row.lastError}</td>
                    <td className={td}>
                      <AdminResendNotificationButton id={row.id} />
                    </td>
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
