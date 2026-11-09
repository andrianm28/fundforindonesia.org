import type { StatusHistoryEntry } from '@/lib/campaign-status-history';

/**
 * Jakarta time whatever zone the server runs in, formatted on the server so
 * the browser has nothing of its own to format and hydrate differently.
 */
function formatWhen(at: Date): string {
  return at.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB';
}

/**
 * The Campaign's status history (PKS pasal 3.4), oldest first. Staff-only:
 * the moderation page and the admin Campaign page render it, and the entries
 * carry who acted and why (see loadCampaignStatusHistory).
 */
export function CampaignStatusHistory({ entries }: { entries: readonly StatusHistoryEntry[] }) {
  return (
    <section aria-labelledby="status-history-heading" className="bg-white rounded-xl border border-border p-6">
      <h2 id="status-history-heading" className="text-sm font-semibold text-text mb-4">
        Riwayat Status
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-text-secondary">Belum ada perubahan status yang tercatat.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="border-l-2 border-border pl-3">
              <p className="text-sm font-medium text-text">{entry.label}</p>
              <p className="text-xs text-text-secondary">
                {formatWhen(entry.at)} &middot; {entry.actorName ? `${entry.actorName} (${entry.capacity})` : entry.capacity}
              </p>
              {entry.reason && <p className="text-sm text-[#424242] mt-1 whitespace-pre-line break-words">{entry.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
