import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { formatRupiah } from '@/lib/utils/currency';
import { PAYOUT_STATUS_LABEL } from '@/lib/payout-status-label';
import { loadPayoutSubject } from '@/lib/payout-subject-lookup';
import { AdminPayoutActionForm } from '@/components/admin/AdminPayoutActionForm';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * One Payout, for the Admin acting on it: request → approve → complete
 * (CONTEXT.md, Payout; ADR 0006). The form half of /admin/payouts, which
 * only lists.
 *
 * NO BANK ACCOUNT NUMBER, ANYWHERE ON THIS PAGE (ticket 12). The `select`
 * below never names `accountNumberCiphertext` or `accountNumberKeyId`:
 * Sumopod, the only provider active before a disbursement API exists, is
 * withdrawn from by hand in its own dashboard, so nothing on this Payout's
 * path ever needs the plaintext number read. What is shown is what was
 * always plaintext -- bank code and account holder name -- the same two
 * fields the Fundraiser's own picker shows
 * (CampaignPayoutPanel.tsx). Reading the number here would be reading it
 * for a payout that never needed it read, and ADR 0012 says every read is a
 * one-way, unprovable event -- one this page has no reason to spend.
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
        <h1 className="text-2xl font-bold text-gray-900">{subject.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{PAYOUT_STATUS_LABEL[payout.status]}</p>
      </div>

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
