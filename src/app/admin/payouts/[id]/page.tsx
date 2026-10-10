import { SandboxBadge } from '@/components/money/SandboxBadge';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { formatRupiah } from '@/lib/utils/currency';
import { PAYOUT_STATUS_LABEL } from '@/lib/payout-status-label';
import { loadPayoutSubject } from '@/lib/payout-subject-lookup';
import { AdminPayoutActionForm } from '@/components/admin/AdminPayoutActionForm';
import { AdminUsageReportPanel } from '@/components/admin/AdminUsageReportPanel';

type RouteContext = { params: Promise<{ id: string }> };

function formatCheckDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

/**
 * One Payout, for the Admin acting on it: request → approve → complete
 * (CONTEXT.md, Payout; ADR 0006). The form half of /admin/payouts, which
 * only lists.
 *
 * NO BANK ACCOUNT NUMBER IN THIS PAGE'S PAYLOAD (tickets 12 and 89). The
 * `select` below never names `accountNumberCiphertext` or
 * `accountNumberKeyId`, so the number is not in the default render. Sumopod
 * is withdrawn from by hand, so the Admin completing an APPROVED Payout does
 * need the full number (ticket 89 reopened ticket 12's premise): they open it
 * with an explicit server action from AdminPayoutActionForm
 * (/api/admin/payouts/[id]/reveal-account), which allows only that Admin,
 * only while APPROVED, and writes a PayoutAccountReveal audit row each time.
 * What this page shows is bank code and account holder name.
 *
 * TWO SUBJECTS, RESOLVED WITHOUT AN .include(). `volunteerTripId` carries no
 * Prisma relation (schema comment on Payout.volunteerTripId), so a Trip
 * Payout's title and slug come from a second, separate lookup -- never both,
 * because assertExactlyOnePayoutSubject already guarantees the row has
 * exactly one of the two ids set (src/lib/money/payout-subject.ts).
 *
 * STATUS DECIDES THE FORM, NOT A ROLE CHECK HERE. DRAFT gets the approve
 * form, APPROVED gets the complete form, anything else (COMPLETED, REJECTED,
 * ...) gets a read-only summary -- AdminPayoutActionForm makes that same
 * branch and renders nothing for a status it does not recognise as
 * actionable, so this page does not duplicate the list of active statuses.
 *
 * BALANCE CHECK HISTORY (ticket 30). `balanceChecks` is read and shown
 * whatever the Payout's status is, ordered newest first: an append-only
 * trail of every "sudah dicek, kurang" reading an Admin recorded, which
 * owner decision 2026-09-28 keeps even after the Payout is later approved --
 * resolution is read off the Payout's own status (DRAFT means still
 * pending), never a column on the check rows, so nothing here marks a row
 * "resolved" either.
 */
export default async function AdminPayoutDetailPage({ params }: RouteContext) {
  const { id } = await params;

  const session = await getServerSession();
  const actorId = session!.user!.id as string;

  const payout = await prisma.payout.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      completedBy: { select: { name: true } },
      bankAccount: { select: { bankCode: true, accountName: true } },
      // Ticket 22 (PRD FFI-07a): only reachable for a Campaign Payout below,
      // never a Trip one -- Usage Report is scoped to Campaign (CONTEXT.md).
      usageReport: {
        select: {
          id: true,
          narrative: true,
          lineItems: true,
          beneficiaryCount: true,
          photos: true,
          disputedAt: true,
          disputedReason: true,
        },
      },
      // Ticket 30: every "sudah dicek, kurang" reading, newest first -- an
      // append-only trail, never filtered by the Payout's current status.
      balanceChecks: {
        orderBy: { checkedAt: 'desc' },
        select: {
          id: true,
          provider: true,
          recordedBalance: true,
          checkedAt: true,
          checkedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!payout) {
    notFound();
  }

  const subject = await loadPayoutSubject(prisma, payout);

  if (!subject) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {subject.title}
          <SandboxBadge sandbox={payout.sandbox} />
        </h1>
        <p className="mt-1 text-sm text-gray-500">{PAYOUT_STATUS_LABEL[payout.status]}</p>
      </div>

      {payout.status === 'DRAFT' && payout.balanceChecks.length > 0 && (
        <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Menunggu saldo penyedia -- terakhir dicek {formatCheckDate(payout.balanceChecks[0].checkedAt)} oleh{' '}
          {payout.balanceChecks[0].checkedBy.name}.
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Jumlah diajukan</p>
          <p className="text-lg font-semibold text-gray-900">{formatRupiah(payout.amount)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Diajukan oleh</p>
          <p className="text-lg font-semibold text-gray-900">{payout.requestedBy.name}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
          <p className="text-xs text-gray-500">Rekening tujuan</p>
          <p className="text-sm font-medium text-gray-900">
            {payout.bankAccount.bankCode} - {payout.bankAccount.accountName}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
          <p className="text-xs text-gray-500">Keterangan</p>
          <p className="text-sm text-gray-900">{payout.description}</p>
        </div>

        {payout.approvedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Disetujui oleh</p>
            <p className="text-sm font-medium text-gray-900">
              {payout.approvedBy?.name} · {payout.approvedProvider} · saldo tercatat{' '}
              {payout.approvedProviderBalance != null ? formatRupiah(payout.approvedProviderBalance) : '-'}
            </p>
          </div>
        )}

        {payout.completedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Diselesaikan oleh</p>
            <p className="text-sm font-medium text-gray-900">{payout.completedBy?.name}</p>
            <p className="mt-1 text-xs text-gray-500">Bukti transfer</p>
            <p className="text-sm text-gray-900">{payout.proofImage}</p>
          </div>
        )}
      </div>

      {subject.type === 'campaign' && payout.status === 'COMPLETED' && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Usage Report</h2>
          <AdminUsageReportPanel
            slug={subject.slug}
            payoutId={payout.id}
            usageReport={
              payout.usageReport && {
                ...payout.usageReport,
                // Stored as Json (prisma/schema.prisma, UsageReport.lineItems)
                // because nothing else in the app sums or filters by a single
                // line item; submitUsageReport (@/lib/usage-reports.ts) is the
                // one writer, and it only ever writes this exact shape.
                lineItems: payout.usageReport.lineItems as Array<{ label: string; amount: number }>,
                disputedAt: payout.usageReport.disputedAt?.toISOString() ?? null,
              }
            }
          />
        </div>
      )}

      {payout.balanceChecks.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Riwayat cek saldo penyedia</h2>
          <ul className="space-y-2">
            {payout.balanceChecks.map((check) => (
              <li key={check.id} className="text-sm text-gray-900">
                {formatRupiah(check.recordedBalance)} di {check.provider} -- dicek {check.checkedBy.name},{' '}
                {formatCheckDate(check.checkedAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Tindakan</h2>
        <AdminPayoutActionForm
          payoutId={payout.id}
          status={payout.status}
          subject={{ type: subject.type, slug: subject.slug }}
          actorId={actorId}
          requestedById={payout.requestedById}
          approvedById={payout.approvedById}
        />
      </div>
    </div>
  );
}
