import { SandboxBadge } from '@/components/money/SandboxBadge';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';
import { loadRefundSubject } from '@/lib/refund-subject-lookup';
import { REFUND_STATUS_LABEL } from '@/lib/refund-status-label';
import { readRefundDonorAccountNumber } from '@/lib/contact-fields';
import { maskBankAccountNumber } from '@/lib/bank-account-mask';
import { AdminRefundApproveForm } from '@/components/admin/AdminRefundApproveForm';
import { AdminRefundCompleteForm } from '@/components/admin/AdminRefundCompleteForm';
import { AdminRefundResolveForm } from '@/components/admin/AdminRefundResolveForm';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * One Refund, for the Admin acting on it: create → approve → complete
 * (tickets 23 and 31), and the two ways it ends without paying the Donor,
 * reject and fail (tickets 49 and 50; CONTEXT.md, Refund). Processing stays
 * in the schema's RefundStatus for a later rilis. The form half of
 * /admin/refunds, which only lists.
 *
 * TWO SUBJECTS, RESOLVED WITHOUT AN .include(). A Refund's Payment names a
 * Campaign or a Volunteer Trip, never both (assertExactlyOnePaymentSubject),
 * so its title and slug come from refund-subject-lookup.ts's batched-free
 * single lookup -- the same shape the queue page repeats for many rows.
 *
 * STATUS DECIDES THE FORM, NOT A ROLE CHECK HERE. REQUESTED gets the
 * approve form (which itself refuses the requester); APPROVED gets the
 * complete form (ticket 31, which itself refuses both the requester and
 * the approver). The way back sits beside them (ticket 50): REQUESTED and
 * AWAITING_DONOR_DETAILS get the reject form, APPROVED gets the fail form,
 * and each says for itself when the viewer is someone its act bars. All
 * four say so to the subject's Fundraiser, which only this page can tell
 * them (`isOwnSubject`, from the subject lookup's `ownerId`; ticket 55); the
 * server still refuses (403) regardless. REJECTED and FAILED show who ended
 * the Refund, when, and why (ticket 55). Anything else (COMPLETED,
 * REJECTED, FAILED, ...) gets a read-only summary.
 *
 * THE RECORDED DESTINATION IS SHOWN MASKED, NEVER IN FULL (Q7(c), ADR
 * 0018 Amendment 2026-09-28): once an Admin has approved and recorded the
 * Donor's destination, this page shows the bank code and account name
 * plaintext (as CONTEXT.md, Bank Account already does for a Fundraiser's
 * saved account) but only the account number's masked tail
 * (maskBankAccountNumber, @/lib/bank-account-mask.ts) -- the completing
 * Admin re-types the number from the Donor's own written request, not from
 * this screen.
 */
export default async function AdminRefundDetailPage({ params }: RouteContext) {
  const { id } = await params;

  const session = await getServerSession();
  const actorId = session!.user!.id as string;

  const refund = await prisma.refund.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      completedBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
      failedBy: { select: { name: true } },
      payment: {
        select: {
          amount: true,
          donation: { select: { campaignId: true } },
          registration: { select: { batch: { select: { tripId: true } } } },
        },
      },
    },
  });
  if (!refund) {
    notFound();
  }

  const subject = await loadRefundSubject(prisma, refund);
  if (!subject) {
    notFound();
  }
  const isOwnSubject = subject.ownerId === actorId;

  // Decrypted only to mask (Q7(c)): the full number is never handed to the
  // page's render, only the tail maskBankAccountNumber leaves visible.
  const recordedAccountNumber = readRefundDonorAccountNumber({
    donorAccountNumberCiphertext: refund.donorAccountNumberCiphertext,
    donorAccountNumberKeyId: refund.donorAccountNumberKeyId,
  });
  const maskedDonorAccountNumber = recordedAccountNumber ? maskBankAccountNumber(recordedAccountNumber) : null;

  const proofSeparator = ' — ';
  const proofAt = refund.proofImage ? refund.proofImage.indexOf(proofSeparator) : -1;
  const proofReference = proofAt > 0 && refund.proofImage ? refund.proofImage.slice(0, proofAt) : null;
  const proofNote = proofAt > 0 && refund.proofImage ? refund.proofImage.slice(proofAt + proofSeparator.length) : null;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {subject.title}
          <SandboxBadge sandbox={refund.sandbox} />
        </h1>
        <p className="mt-1 text-sm text-gray-500">{REFUND_STATUS_LABEL[refund.status]}</p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Jumlah Refund</p>
          <p className="text-lg font-semibold text-gray-900">{formatRupiah(refund.amount)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Diajukan oleh</p>
          <p className="text-lg font-semibold text-gray-900">{refund.requestedBy.name}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
          <p className="text-xs text-gray-500">Alasan</p>
          <p className="text-sm text-gray-900">{refund.reason}</p>
        </div>

        {refund.approvedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Disetujui oleh</p>
            <p className="text-sm font-medium text-gray-900">{refund.approvedBy?.name}</p>
          </div>
        )}

        {refund.completedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Diselesaikan oleh</p>
            <p className="text-sm font-medium text-gray-900">{refund.completedBy?.name}</p>
            {refund.proofImage && (
              <>
                {/* Stored as one string by buildProofImage ("reference — note");
                    shown as plain text, never as a link or image source. */}
                {proofReference ? (
                  <>
                    <p className="mt-1 text-xs text-gray-500">Referensi transaksi</p>
                    <p className="text-sm text-gray-900">{proofReference}</p>
                    <p className="mt-1 text-xs text-gray-500">Catatan</p>
                    <p className="text-sm text-gray-900">{proofNote}</p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-gray-500">Bukti transfer</p>
                    <p className="text-sm text-gray-900">{refund.proofImage}</p>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {refund.status === 'REJECTED' && refund.rejectedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Ditolak oleh</p>
            <p className="text-sm font-medium text-gray-900">{refund.rejectedBy?.name}</p>
            {refund.rejectedAt && <p className="text-xs text-gray-500">{formatIndonesianDate(refund.rejectedAt)}</p>}
            <p className="mt-1 text-xs text-gray-500">Alasan penolakan</p>
            <p className="text-sm text-gray-900">{refund.rejectionReason}</p>
          </div>
        )}

        {refund.status === 'FAILED' && refund.failedById && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Ditandai gagal oleh</p>
            <p className="text-sm font-medium text-gray-900">{refund.failedBy?.name}</p>
            {refund.failedAt && <p className="text-xs text-gray-500">{formatIndonesianDate(refund.failedAt)}</p>}
            <p className="mt-1 text-xs text-gray-500">Alasan kegagalan</p>
            <p className="text-sm text-gray-900">{refund.failureReason}</p>
          </div>
        )}

        {refund.donorBankCode && refund.donorAccountName && maskedDonorAccountNumber && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 sm:col-span-2">
            <p className="text-xs text-gray-500">Rekening tujuan Donor (dicatat saat persetujuan)</p>
            <p className="text-sm font-medium text-gray-900">
              {refund.donorBankCode} -- {refund.donorAccountName} -- {maskedDonorAccountNumber}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {refund.status === 'REQUESTED' && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Tindakan</h2>
            <p className="mb-3 text-xs text-gray-500">
              Aturan dua orang: Admin yang menyetujui harus berbeda dari yang mengajukan.
            </p>
            <AdminRefundApproveForm
              refundId={refund.id}
              subject={{ type: subject.type, slug: subject.slug }}
              actorId={actorId}
              requestedById={refund.requestedById}
              isOwnSubject={isOwnSubject}
            />
          </div>
        )}

        {(refund.status === 'REQUESTED' || refund.status === 'AWAITING_DONOR_DETAILS') && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Tolak Refund</h2>
            <p className="mb-3 text-xs text-gray-500">
              Hanya sebelum disetujui. Frozen Balance Refund ini dikembalikan ke saldo asalnya. Admin yang menolak
              harus berbeda dari yang mengajukan, dan bukan Fundraiser Campaign atau Volunteer Trip ini.
            </p>
            <AdminRefundResolveForm
              action="reject"
              refundId={refund.id}
              subject={{ type: subject.type, slug: subject.slug }}
              actorId={actorId}
              requestedById={refund.requestedById}
              approvedById={refund.approvedById}
              isOwnSubject={isOwnSubject}
            />
          </div>
        )}

        {refund.status === 'APPROVED' && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Tandai selesai</h2>
            <p className="mb-3 text-xs text-gray-500">
              Aturan dua orang: Admin yang menyelesaikan harus berbeda dari yang
              mengajukan maupun yang menyetujui, dan mentransfer dana secara manual ke rekening Donor -- yang sudah
              dicatat Admin yang menyetujui -- sebelum mengetik ulang nomor rekening dan mencatat bukti transfer di
              sini.
            </p>
            <AdminRefundCompleteForm
              refundId={refund.id}
              subject={{ type: subject.type, slug: subject.slug }}
              actorId={actorId}
              requestedById={refund.requestedById}
              approvedById={refund.approvedById}
              isOwnSubject={isOwnSubject}
            />
          </div>
        )}

        {refund.status === 'APPROVED' && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Tandai gagal</h2>
            <p className="mb-3 text-xs text-gray-500">
              Untuk Refund yang sudah disetujui tetapi tidak bisa dibayar ke Donor. Dana kembali ke saldo asalnya. Admin
              yang menandai harus berbeda dari yang menyetujui, dan bukan Fundraiser Campaign atau Volunteer Trip ini.
            </p>
            <AdminRefundResolveForm
              action="fail"
              refundId={refund.id}
              subject={{ type: subject.type, slug: subject.slug }}
              actorId={actorId}
              requestedById={refund.requestedById}
              approvedById={refund.approvedById}
              isOwnSubject={isOwnSubject}
            />
          </div>
        )}
      </div>
    </div>
  );
}

