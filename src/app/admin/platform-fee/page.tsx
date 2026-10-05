import { prisma } from '@/lib/prisma';
import { AdminPlatformFeeForm } from '@/components/admin/AdminPlatformFeeForm';
import type { Kind } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';

/**
 * Ticket 88 (plan A-1: `/api/admin/platform-fee` had no page behind it):
 * shows the Platform Fee rules in force and their history, and edits them
 * through the existing POST /api/admin/platform-fee route (AdminPlatformFeeForm).
 * CONTEXT.md, Platform Fee; src/lib/money/platform-fee-config.ts.
 *
 * Every number here is a row's own value. The page carries no rate, no
 * threshold and no per-Kind default: the owner's figures are still a
 * recommendation (C3), so a Kind with no row reads "belum diatur" -- which
 * resolvePlatformFeeBasis treats as 0 -- rather than a number invented here.
 * Rows are append-only, so the newest row per scope and key is the one in
 * force (the same rule resolvePlatformFeeBasis applies), and setBy/setAt on
 * it are the "who and when".
 */

const KINDS: Kind[] = ['DONATION', 'ZAKAT', 'WAKAF', 'HIBAH'];

function formatPercent(percentBps: number): string {
  return `${(percentBps / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
}

function formatRupiahAmount(amount: number): string {
  return `Rp${amount.toLocaleString('id-ID')}`;
}

function formatWhen(at: Date): string {
  return (
    new Date(at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB'
  );
}

export default async function AdminPlatformFeePage() {
  const [rules, thresholds] = await Promise.all([
    prisma.platformFeeRule.findMany({
      orderBy: { setAt: 'desc' },
      include: { setBy: { select: { name: true } }, campaign: { select: { title: true, slug: true } } },
    }),
    prisma.platformFeeThreshold.findMany({
      orderBy: { setAt: 'desc' },
      include: { setBy: { select: { name: true } } },
    }),
  ]);

  // First row met per key, in newest-first order, is the one in force.
  const byKind = new Map<Kind, (typeof rules)[number]>();
  const byCategory = new Map<string, (typeof rules)[number]>();
  const byCampaign = new Map<string, (typeof rules)[number]>();
  for (const row of rules) {
    if (row.scope === 'KIND' && row.kind && !byKind.has(row.kind)) byKind.set(row.kind, row);
    if (row.scope === 'CATEGORY' && row.category && !byCategory.has(row.category)) byCategory.set(row.category, row);
    if (row.scope === 'CAMPAIGN' && row.campaignId && !byCampaign.has(row.campaignId)) byCampaign.set(row.campaignId, row);
  }
  const currentThreshold = thresholds[0] ?? null;

  const history = [
    ...rules.map((row) => ({
      key: `rule-${row.id}`,
      at: new Date(row.setAt),
      what:
        row.scope === 'KIND'
          ? `Kind ${String(row.kind).toLowerCase()}`
          : row.scope === 'CATEGORY'
            ? `Category ${row.category}`
            : `Campaign ${row.campaign?.title ?? row.campaignId}`,
      value: formatPercent(row.percentBps),
      by: row.setBy?.name ?? 'Admin',
    })),
    ...thresholds.map((row) => ({
      key: `threshold-${row.id}`,
      at: new Date(row.setAt),
      what: 'Ambang pembebasan',
      value: formatRupiahAmount(row.amount),
      by: row.setBy?.name ?? 'Admin',
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const th = 'px-3 py-2 text-left text-xs font-semibold text-gray-500';
  const td = 'px-3 py-2 text-sm text-gray-800';

  function changedBy(row: { setBy?: { name: string } | null; setAt: Date }) {
    return `${row.setBy?.name ?? 'Admin'}, ${formatWhen(row.setAt)}`;
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Fee</h1>
        <p className="mt-1 text-sm text-gray-500">
          Potongan persentase dari Donation, diatur per Kind dengan override per Category dan per Campaign. Setiap
          perubahan tersimpan sebagai baris baru; Payment yang sudah dibuat tetap memakai fee yang berlaku saat itu.
        </p>
      </div>

      <section aria-labelledby="fee-current" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="fee-current" className="mb-3 text-lg font-semibold text-gray-900">
          Aturan yang berlaku
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Berlaku untuk</th>
                <th className={th}>Nilai</th>
                <th className={th}>Terakhir diubah</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {KINDS.map((kind) => {
                const row = byKind.get(kind);
                return (
                  <tr key={kind}>
                    <td className={td}>{kind.toLowerCase()}</td>
                    <td className={td}>{row ? formatPercent(row.percentBps) : 'Belum diatur'}</td>
                    <td className={td}>{row ? changedBy(row) : '-'}</td>
                  </tr>
                );
              })}
              {[...byCategory.values()].map((row) => (
                <tr key={`cat-${row.category}`}>
                  <td className={td}>
                    Category: <span>{row.category}</span>
                  </td>
                  <td className={td}>{formatPercent(row.percentBps)}</td>
                  <td className={td}>{changedBy(row)}</td>
                </tr>
              ))}
              {[...byCampaign.values()].map((row) => (
                <tr key={`camp-${row.campaignId}`}>
                  <td className={td}>
                    Campaign: <span>{row.campaign?.title ?? row.campaignId}</span>
                  </td>
                  <td className={td}>{formatPercent(row.percentBps)}</td>
                  <td className={td}>{changedBy(row)}</td>
                </tr>
              ))}
              <tr>
                <td className={td}>Ambang pembebasan</td>
                <td className={td}>{currentThreshold ? formatRupiahAmount(currentThreshold.amount) : 'Belum diatur'}</td>
                <td className={td}>{currentThreshold ? changedBy(currentThreshold) : '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Urutan yang dipakai untuk satu Campaign: override Campaign, lalu Category, lalu Kind. Tanpa aturan sama
          sekali, fee-nya 0.
        </p>
      </section>

      <section aria-labelledby="fee-form" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="fee-form" className="mb-3 text-lg font-semibold text-gray-900">
          Tambah atau ubah aturan
        </h2>
        <AdminPlatformFeeForm />
      </section>

      <section aria-labelledby="fee-history" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="fee-history" className="mb-3 text-lg font-semibold text-gray-900">
          Riwayat perubahan
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">Belum ada perubahan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Waktu</th>
                  <th className={th}>Yang diubah</th>
                  <th className={th}>Nilai</th>
                  <th className={th}>Oleh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((row) => (
                  <tr key={row.key}>
                    <td className={td}>{formatWhen(row.at)}</td>
                    <td className={td}>{row.what}</td>
                    <td className={td}>{row.value}</td>
                    <td className={td}>{row.by}</td>
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
