import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyPaymentResultToken } from '@/lib/money/payment-result-token';
import { describePaymentResult, type PaymentResultState } from '@/lib/money/payment-result';
import { formatRupiah } from '@/lib/utils/currency';
import { PaymentResultActions } from './PaymentResultActions';

// Read per request: the status changes the moment the webhook lands.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Status Pembayaran Donasi',
  robots: { index: false, follow: false },
  // The token is in this page's URL: never hand it to the provider's payment
  // page or anywhere else this page links to.
  referrer: 'no-referrer',
};

interface PaymentResultPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ batal?: string | string[] }>;
}

const COPY: Record<PaymentResultState, { title: string; body: string; tone: 'wait' | 'good' | 'bad' }> = {
  menunggu: {
    title: 'Menunggu konfirmasi pembayaran',
    body: 'Kami belum menerima konfirmasi pembayaran dari penyedia pembayaran. Jika Anda sudah membayar, konfirmasi biasanya masuk dalam beberapa menit dan halaman ini akan diperbarui.',
    tone: 'wait',
  },
  berhasil: {
    title: 'Pembayaran berhasil',
    body: 'Terima kasih, donasi Anda sudah kami terima. Bukti donasi juga dikirim ke email Anda.',
    tone: 'good',
  },
  gagal: {
    title: 'Pembayaran gagal',
    body: 'Pembayaran untuk donasi ini tidak berhasil diproses.',
    tone: 'bad',
  },
  kedaluwarsa: {
    title: 'Waktu pembayaran habis',
    body: 'Batas waktu pembayaran sudah lewat sebelum pembayaran kami terima.',
    tone: 'bad',
  },
  dikembalikan: {
    title: 'Dana dikembalikan',
    body: 'Pembayaran untuk donasi ini sudah dikembalikan.',
    tone: 'bad',
  },
};

const TONE_CLASS = {
  wait: 'bg-[#FFF8E1] text-[#8D6E00]',
  good: 'bg-[#E8F5E9] text-[#2E7D32]',
  bad: 'bg-[#FFEBEE] text-[#C62828]',
};

/**
 * Where the payment provider sends a Donor back after paying or backing out
 * (ticket 98). Opened by the signed token in the URL alone: a Guest Donor has no
 * session, so this page never reads one, and it shows nothing about the Donor --
 * only the Campaign, the amount and the status the database holds. The provider's
 * redirect proves nothing; only the signed webhook settles a Payment.
 */
export default async function PaymentResultPage({ params, searchParams }: PaymentResultPageProps) {
  const { token } = await params;
  const { batal } = await searchParams;

  const now = new Date();
  // Checked before any database read: a guessed or tampered token costs one HMAC.
  const donationId = verifyPaymentResultToken(token, now.getTime());
  if (!donationId) notFound();

  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    select: {
      id: true,
      amount: true,
      paymentStatus: true,
      donorId: true,
      campaign: { select: { title: true, slug: true } },
      receipt: { select: { token: true } },
      payments: { select: { status: true, expiresAt: true, redirectUrl: true, createdAt: true } },
    },
  });
  if (!donation) notFound();

  const result = describePaymentResult(donation, now);
  const copy = COPY[result.state];
  const cancelled = batal === '1' && result.state !== 'berhasil' && result.state !== 'dikembalikan';

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <p className="text-white text-lg font-semibold">Status Pembayaran</p>
      </div>

      <div className="px-4 mt-4 space-y-3">
        <div className="rounded-xl bg-white p-4 shadow-xs">
          <p className="text-text-secondary text-xs">Donasi untuk</p>
          <Link href={`/campaign/${donation.campaign.slug}`} className="text-text text-sm font-semibold hover:underline">
            {donation.campaign.title}
          </Link>
          <p className="mt-2 text-[#0073E6] text-base font-bold">{formatRupiah(donation.amount)}</p>
        </div>

        {cancelled && (
          <p className="rounded-xl bg-[#E3F2FD] p-4 text-sm text-text">Anda keluar dari halaman pembayaran sebelum selesai.</p>
        )}

        <div className={`rounded-xl p-4 ${TONE_CLASS[copy.tone]}`}>
          <h1 className="text-base font-semibold">{copy.title}</h1>
          <p className="mt-1 text-sm">{copy.body}</p>
        </div>

        {result.state === 'berhasil' && donation.receipt && (
          <Link
            href={`/receipt/${donation.receipt.token}`}
            className="block rounded-xl bg-[#0073E6] px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Lihat bukti donasi
          </Link>
        )}

        <PaymentResultActions
          donationId={donation.id}
          waiting={result.state === 'menunggu'}
          continueUrl={result.continueUrl}
          canRetry={result.canRetry}
          accountOwned={Boolean(donation.donorId)}
        />

        {result.state === 'gagal' && !result.canRetry && (
          <Link
            href={`/campaign/${donation.campaign.slug}`}
            className="block text-center text-sm font-medium text-[#0073E6] hover:underline"
          >
            Kembali ke halaman campaign
          </Link>
        )}
      </div>
    </div>
  );
}
