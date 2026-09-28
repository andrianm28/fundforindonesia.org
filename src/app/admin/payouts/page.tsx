import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';
import { loadPayoutSubjects, payoutSubjectKey, type PayoutSubjectInfo } from '@/lib/payout-subject-lookup';
import type { Payout, PayoutStatus } from '@/generated/prisma/client';

/**
 * The Admin queue a Payout raised through the product has nowhere else to
 * be seen on (map.md: "No Admin panel for Payouts. approvePayout and
 * completePayout exist and enforce the two-person rule, but no screen in
 * src/app/admin calls either. A Payout raised through the product stays
 * PENDING."). This is that screen's list half; /admin/payouts/[id] is the
 * form half.
 *
 * Two groups, not one list with a status column: DRAFT and APPROVED are the
 * only two states an Admin has anything left to do about -- REJECTED,
 * COMPLETED and everything else is a decision already made, and belongs on
 * a history a Fundraiser reads, not a queue an Admin works.
 *
 * A Payout names a Campaign or a Volunteer Trip, never both
 * (assertExactlyOnePayoutSubject, src/lib/money/payout-subject.ts), and
 * `volunteerTripId` carries no Prisma relation (schema comment: "neither
 * this nor any other ticket has needed .include() through it yet"), so the
 * subject's title and slug are read in two batched queries rather than one
 * .include() -- the same shape the detail page repeats for one row.
 */

const QUEUE_STATUSES: PayoutStatus[] = ['DRAFT', 'APPROVED'];

type QueueRow = Pick<
  Payout,
  'id' | 'campaignId' | 'volunteerTripId' | 'amount' | 'description' | 'status' | 'createdAt'
> & {
  requestedBy: { name: string | null };
  bankAccount: { bankCode: string; accountName: string };
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date),
  );
}

function QueueTable({
  title,
  payouts,
  subjects,
}: {
  title: string;
  payouts: QueueRow[];
  subjects: Map<string, PayoutSubjectInfo>;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subjek</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fundraiser</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Jumlah</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rekening tujuan</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Diajukan</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Aksi</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    Tidak ada Payout di antrean ini.
                  </td>
                </tr>
              ) : (
                payouts.map((payout) => {
                  const subject = subjects.get(payoutSubjectKey(payout));
                  return (
                    <tr key={payout.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900">{subject?.title ?? 'Tidak diketahui'}</p>
                        <p className="text-xs text-gray-500 truncate max-w-xs">{payout.description}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{payout.requestedBy.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{formatRupiah(payout.amount)}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {payout.bankAccount.bankCode} - {payout.bankAccount.accountName}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{formatDate(payout.createdAt)}</td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/payouts/${payout.id}`}
                          className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          Tinjau
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default async function AdminPayoutsPage() {
  const payouts = (await prisma.payout.findMany({
    where: { status: { in: QUEUE_STATUSES } },
    orderBy: { createdAt: 'asc' },
    include: {
      requestedBy: { select: { name: true } },
      bankAccount: { select: { bankCode: true, accountName: true } },
    },
  })) as QueueRow[];

  const subjects = await loadPayoutSubjects(prisma, payouts);
  const awaitingApproval = payouts.filter((p) => p.status === 'DRAFT');
  const awaitingCompletion = payouts.filter((p) => p.status === 'APPROVED');

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Pencairan Dana (Payout)</h1>
        <p className="text-gray-600 mt-1">
          Setiap Payout melewati dua orang berbeda: satu Admin menyetujui, Admin lain yang menandainya selesai
          dengan bukti (FFI-07).
        </p>
      </div>

      <QueueTable title="Menunggu persetujuan" payouts={awaitingApproval} subjects={subjects} />
      <QueueTable title="Menunggu penyelesaian dengan bukti" payouts={awaitingCompletion} subjects={subjects} />
    </div>
  );
}
