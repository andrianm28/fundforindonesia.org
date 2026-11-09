import { prisma } from '@/lib/prisma';
import { clientAddress } from '@/lib/client-ip';
import { guardRoute } from '@/lib/rate-limit-guard';
import { receiptNeedsBetaNotice } from '@/lib/money/counted-payment';
import { buildReceiptPdf } from '@/lib/receipt-pdf';
import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';

const RECEIPT_PDF_LIMIT = 60;
const RECEIPT_PDF_WINDOW_SECONDS = 60 * 60;

/**
 * The Receipt as a PDF download (PKS 3.8). Gated exactly like the print page
 * it is offered from: by the token alone (a Guest Donor has no session), and
 * it shows what that page shows, so an anonymised Donor stays anonymous.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  // Public and unauthenticated, so capped per address. Fail-open: a limiter
  // outage must not stop a Donor downloading their own Receipt.
  const refused = await guardRoute(
    {
      scope: 'receipt-pdf',
      subject: clientAddress(request.headers),
      limit: RECEIPT_PDF_LIMIT,
      windowSeconds: RECEIPT_PDF_WINDOW_SECONDS,
      onUnavailable: 'open',
    },
    { limited: 'Terlalu banyak permintaan unduh bukti donasi. Coba lagi nanti.' },
  );
  if (refused) return refused;

  const { token } = await params;

  const receipt = await prisma.receipt.findUnique({
    where: { token },
    include: {
      donation: {
        include: {
          campaign: { include: { collectingEntity: true } },
          donor: { select: { id: true, name: true } },
          payments: { select: { sandbox: true } },
        },
      },
    },
  });

  if (!receipt) {
    return Response.json({ error: 'Bukti donasi tidak ditemukan' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }

  const { donation } = receipt;
  const donorName = donation.anonymisedAt
    ? 'Donor anonim'
    : (donation.donor?.name ?? donation.guestName ?? 'Donor');

  const pdf = buildReceiptPdf({
    campaignTitle: donation.campaign.title,
    collectingEntityName: donation.campaign.collectingEntity?.name ?? '',
    amountLabel: formatRupiah(donation.amount),
    dateLabel: formatIndonesianDate(receipt.sentAt ?? receipt.createdAt),
    donorName,
    betaSandbox: receiptNeedsBetaNotice(donation.payments),
    zakat: donation.campaign.kind === 'ZAKAT',
  });

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="bukti-donasi-${receipt.token.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
