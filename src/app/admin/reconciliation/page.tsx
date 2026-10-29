import { prisma } from '@/lib/prisma';
import { AdminProviderWithdrawalForm } from '@/components/admin/AdminProviderWithdrawalForm';
import { buildReconciliationReport } from '@/lib/money/reconciliation-report';
import { listReconciliationQueue, WEBHOOK_OUTCOME } from '@/lib/money/payment-reconciliation';
import { PAYMENT_PROVIDER_NAMES } from '@/lib/payments/provider-names';
import { formatRupiah } from '@/lib/utils/currency';

export const dynamic = 'force-dynamic';

/**
 * Ticket 63 (plan A-2): reconciliation from the Admin screen, without psql.
 * Shows the report GET /api/admin/reconcile returns (buildReconciliationReport,
 * the same function), the work list of webhook events that need an Admin and
 * charges with no Payment (listReconciliationQueue), and records a sweep from a
 * provider through POST /api/admin/provider-withdrawals.
 *
 * Reports, never corrects: nothing here writes except the withdrawal form, and
 * that only records what the provider's dashboard already shows. Access is the
 * /admin layout's ADMIN check, which gives anyone else a 404.
 * Runbook: docs/runbooks/payment-reconciliation.md.
 */

const OUTCOME_LABEL: Record<string, string> = {
  [WEBHOOK_OUTCOME.AMOUNT_MISMATCH]: 'Nominal tidak cocok',
  [WEBHOOK_OUTCOME.SIBLING_ALREADY_PAID]: 'Payment lain di Donasi yang sama sudah dibayar',
  [WEBHOOK_OUTCOME.UNKNOWN_PAYMENT]: 'Payment tidak dikenal',
  [WEBHOOK_OUTCOME.LATE_SETTLEMENT_REFUND_FAILED]: 'Refund otomatis Trip Fee gagal',
};

function formatWhen(at: Date | string | null): string {
  if (at == null) return '-';
  return (
    new Date(at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB'
  );
}

/** One cell of a finding's row: dates in WIB, nested values as JSON, the rest as text. */
function cell(value: unknown): string {
  if (value == null) return '-';
  if (value instanceof Date) return formatWhen(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const th = 'px-3 py-2 text-left text-xs font-semibold text-gray-500';
const td = 'px-3 py-2 text-sm text-gray-800';
const flagged = 'inline-block rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700';
const fine = 'inline-block rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700';
const unchecked = 'inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700';

function RowsTable({ rows }: { rows: object[] }) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className={th}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((column) => (
                <td key={column} className={td}>
                  {cell((row as Record<string, unknown>)[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminReconciliationPage() {
  const [report, queue, collectingEntities] = await Promise.all([
    prisma.$transaction((tx) => buildReconciliationReport(tx)),
    listReconciliationQueue(prisma),
    prisma.partnerOrganisation.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const providerReport = report.providerReconciliation;

  // Each a finding: something an Admin must look at. Pending Refunds and Manual
  // Contributions are ordinary work queues with their own screens, so they are
  // listed below as a count, not as a finding.
  const findings: Array<{ label: string; rows: object[] }> = [
    { label: 'Transaksi ledger tidak seimbang', rows: report.unbalancedTransactions },
    { label: 'Saldo Campaign negatif', rows: report.negativeBalances },
    { label: 'Saldo Volunteer Trip negatif', rows: report.tripNegativeBalances },
    { label: 'Dana terkumpul Campaign tidak cocok dengan ledger', rows: report.mismatches },
    { label: 'Escrow tertinggal setelah dilepas (Campaign)', rows: report.strandedEscrow },
    { label: 'Escrow tertinggal setelah dilepas (Volunteer Trip)', rows: report.tripStrandedEscrow },
    { label: 'Escrow matang yang belum dilepas (Campaign)', rows: report.deferredEscrowWatchdog },
    { label: 'Escrow matang yang belum dilepas (Volunteer Trip)', rows: report.tripDeferredEscrowWatchdog },
    { label: 'Payment tanpa Donasi maupun Registrasi', rows: report.subjectlessPayments },
    { label: 'Payment Registrasi batal tanpa Refund', rows: report.orphanedCancelledRegistrationPayments },
    { label: 'Payout PROCESSING yang menggantung', rows: report.stuckPayouts.processing },
    { label: 'Payout APPROVED tanpa referensi penyedia', rows: report.stuckPayouts.approvedWithoutProviderRef },
  ];
  const divergentProviders = providerReport.divergence.providersWithDivergence;
  const findingCount =
    findings.reduce((total, f) => total + f.rows.length, 0) +
    divergentProviders.length +
    queue.webhookEvents.length +
    queue.chargeWriteFailures.length;

  const sweeps = providerReport.withdrawals
    .flatMap((r) => r.withdrawals)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
  // The registry's real providers first, so the form opens on one; mock stays
  // selectable for a beta or local database.
  const providerOptions = [...PAYMENT_PROVIDER_NAMES].sort((a, b) => Number(a === 'mock') - Number(b === 'mock'));

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Rekonsiliasi</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mencocokkan ledger dengan saldo di penyedia pembayaran. Halaman ini hanya melaporkan; tidak ada yang
          dikoreksi otomatis. Dibuat {formatWhen(report.generatedAt)}.
        </p>
      </div>

      <section aria-labelledby="rec-summary" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="rec-summary" className="mb-3 text-lg font-semibold text-gray-900">
          Ringkasan
        </h2>
        {findingCount === 0 ? (
          <p className="text-sm text-green-700">Tidak ada temuan. Ledger dan antrean bersih.</p>
        ) : (
          <p className="text-sm font-semibold text-red-700">{findingCount} temuan perlu diperiksa.</p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Pemeriksaan</th>
                <th className={th}>Jumlah</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {findings.map((f) => (
                <tr key={f.label}>
                  <td className={td}>{f.label}</td>
                  <td className={td}>
                    {f.rows.length === 0 ? <span className={fine}>0</span> : <span className={flagged}>{f.rows.length}</span>}
                  </td>
                </tr>
              ))}
              <tr>
                <td className={td}>Penyedia dengan selisih penarikan</td>
                <td className={td}>
                  {divergentProviders.length === 0 ? (
                    <span className={fine}>0</span>
                  ) : (
                    <span className={flagged}>{divergentProviders.length}</span>
                  )}
                </td>
              </tr>
              <tr>
                <td className={td}>Webhook dan charge yang perlu ditinjau</td>
                <td className={td}>
                  {queue.webhookEvents.length + queue.chargeWriteFailures.length === 0 ? (
                    <span className={fine}>0</span>
                  ) : (
                    <span className={flagged}>{queue.webhookEvents.length + queue.chargeWriteFailures.length}</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Antrean kerja biasa: {report.pendingRefunds.length} Refund menunggu persetujuan,{' '}
          {report.pendingManualContributions.length} Manual Contribution menunggu keputusan. Campaign lama tanpa
          ledger ({report.preLedger.length}) dan Campaign demo memang tidak dihitung.
        </p>
        {findings
          .filter((f) => f.rows.length > 0)
          .map((f) => (
            <details key={f.label} open className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-gray-900">{f.label}</summary>
              <div className="mt-2">
                <RowsTable rows={f.rows} />
              </div>
            </details>
          ))}
      </section>

      <section aria-labelledby="rec-providers" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="rec-providers" className="mb-3 text-lg font-semibold text-gray-900">
          Saldo per penyedia
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Penyedia</th>
                <th className={th}>Masuk</th>
                <th className={th}>Keluar</th>
                <th className={th}>Saldo menurut ledger</th>
                <th className={th}>Penarikan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {providerReport.pots.map((pot) => {
                const checked = providerReport.withdrawals.find((r) => r.provider === pot.provider);
                return (
                  <tr key={pot.provider ?? '(tanpa nama)'}>
                    <td className={td}>{pot.provider ?? 'Tanpa nama penyedia'}</td>
                    <td className={td}>{formatRupiah(pot.debited)}</td>
                    <td className={td}>{formatRupiah(pot.credited)}</td>
                    <td className={td}>{formatRupiah(pot.balance)}</td>
                    <td className={td}>
                      {pot.provider === null ? (
                        '-'
                      ) : !checked ? (
                        <span className={unchecked}>Belum pernah dicek</span>
                      ) : checked.difference !== 0 ? (
                        <span className={flagged}>Selisih {formatRupiah(checked.difference)}</span>
                      ) : (
                        <span className={fine}>Cocok</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!providerReport.perProviderIsExact && (
          <p className="mt-3 text-xs text-amber-700">
            {formatRupiah(providerReport.unattributedBalance)} bergerak tanpa nama penyedia (Payout selesai atau
            Refund dibayar), jadi saldo per penyedia di atas adalah batas bawah, bukan total.
          </p>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Total di penyedia {formatRupiah(providerReport.providerBalanceTotal)}. Sudah sampai di rekening{' '}
          {formatRupiah(providerReport.collectionAccountBalance)}. Penyedia yang belum pernah dicatat penarikannya belum
          diperiksa, bukan lolos.
        </p>

        <h3 className="mb-2 mt-6 text-sm font-semibold text-gray-900">Penarikan tercatat</h3>
        {sweeps.length === 0 ? (
          <p className="text-sm text-gray-500">Belum ada penarikan yang dicatat.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Waktu</th>
                  <th className={th}>Penyedia</th>
                  <th className={th}>Referensi</th>
                  <th className={th}>Nominal dicatat</th>
                  <th className={th}>Turun di dashboard</th>
                  <th className={th}>Hasil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sweeps.map((sweep) => (
                  <tr key={sweep.withdrawalId}>
                    <td className={td}>{formatWhen(sweep.recordedAt)}</td>
                    <td className={td}>{sweep.provider}</td>
                    <td className={td}>{sweep.reference}</td>
                    <td className={td}>{formatRupiah(sweep.amount)}</td>
                    <td className={td}>{formatRupiah(sweep.providerMovedBy)}</td>
                    <td className={td}>
                      {sweep.difference === 0 ? (
                        <span className={fine}>Cocok</span>
                      ) : (
                        <span className={flagged}>Selisih {formatRupiah(sweep.difference)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="rec-withdrawal" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="rec-withdrawal" className="mb-3 text-lg font-semibold text-gray-900">
          Catat penarikan dari penyedia
        </h2>
        <AdminProviderWithdrawalForm providers={providerOptions} collectingEntities={collectingEntities} />
      </section>

      <section aria-labelledby="rec-queue" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="rec-queue" className="mb-3 text-lg font-semibold text-gray-900">
          Antrean webhook yang perlu ditinjau
        </h2>
        {queue.webhookEvents.length === 0 ? (
          <p className="text-sm text-gray-500">Tidak ada webhook yang perlu ditinjau.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Diterima</th>
                  <th className={th}>Penyedia</th>
                  <th className={th}>Jenis</th>
                  <th className={th}>ID event penyedia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {queue.webhookEvents.map((event) => (
                  <tr key={event.id}>
                    <td className={td}>{formatWhen(event.receivedAt)}</td>
                    <td className={td}>{event.provider}</td>
                    <td className={td}>
                      {OUTCOME_LABEL[event.outcome ?? ''] ?? event.outcome}{' '}
                      <span className="text-xs text-gray-400">({event.outcome})</span>
                    </td>
                    <td className={td}>{event.providerEventId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mb-2 mt-6 text-sm font-semibold text-gray-900">Charge tanpa Payment</h3>
        {queue.chargeWriteFailures.length === 0 ? (
          <p className="text-sm text-gray-500">Tidak ada charge tanpa Payment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Dibuat</th>
                  <th className={th}>Penyedia</th>
                  <th className={th}>Referensi order</th>
                  <th className={th}>Untuk</th>
                  <th className={th}>Nominal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {queue.chargeWriteFailures.map((failure) => (
                  <tr key={failure.id}>
                    <td className={td}>{formatWhen(failure.createdAt)}</td>
                    <td className={td}>{failure.provider}</td>
                    <td className={td}>{failure.providerRef}</td>
                    <td className={td}>{failure.subjectType === 'donation' ? 'Donasi' : 'Registrasi'}</td>
                    <td className={td}>{formatRupiah(failure.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Langkah per jenis ada di runbook rekonsiliasi pembayaran. Cocokkan ID event atau referensi order dengan
          dashboard penyedia.
        </p>
      </section>
    </div>
  );
}
