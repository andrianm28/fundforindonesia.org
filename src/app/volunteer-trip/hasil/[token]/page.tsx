import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PaymentStatus } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyRegistrationResultToken } from '@/lib/money/registration-result-token';
import { transactionDetails } from '@/lib/money/payment-result';
import { safePaymentLink } from '@/lib/payments/payment-link';
import { formatRupiah } from '@/lib/utils/currency';
import { formatWibDate } from '@/lib/volunteer/batch-dates';

// Read per request: the status changes the moment the webhook lands, and Next
// marks a dynamic page `no-store`, so no proxy keeps a copy of what is behind
// the token.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Status Pembayaran Trip Fee',
  robots: { index: false, follow: false },
  // The token is in this page's URL: never hand it to the provider's payment
  // page or anywhere else this page links to.
  referrer: 'no-referrer',
};

interface RegistrationResultPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ batal?: string | string[] }>;
}

type Tone = 'wait' | 'good' | 'bad';

/** The Payment's own status, said plainly: this page decides nothing the database has not. */
const COPY: Record<PaymentStatus | 'NONE', { title: string; body: string; tone: Tone }> = {
  PENDING: {
    title: 'Menunggu konfirmasi pembayaran',
    body: 'Kami belum menerima konfirmasi pembayaran dari penyedia pembayaran. Jika Anda sudah membayar, konfirmasi biasanya masuk dalam beberapa menit. Muat ulang halaman ini untuk melihat status terbaru.',
    tone: 'wait',
  },
  PAID: {
    title: 'Pembayaran berhasil',
    body: 'Terima kasih, Trip Fee Anda sudah kami terima.',
    tone: 'good',
  },
  FAILED: {
    title: 'Pembayaran gagal',
    body: 'Pembayaran Trip Fee ini tidak berhasil diproses.',
    tone: 'bad',
  },
  EXPIRED: {
    title: 'Waktu pembayaran habis',
    body: 'Batas waktu pembayaran sudah lewat sebelum pembayaran kami terima.',
    tone: 'bad',
  },
  REFUNDED: {
    title: 'Dana dikembalikan',
    body: 'Pembayaran Trip Fee ini sudah dikembalikan.',
    tone: 'bad',
  },
  NONE: {
    title: 'Pembayaran belum tercatat',
    body: 'Kami belum mencatat pembayaran untuk registrasi ini.',
    tone: 'bad',
  },
};

const TONE_CLASS: Record<Tone, string> = {
  wait: 'bg-[#FFF8E1] text-[#8D6E00]',
  good: 'bg-[#E8F5E9] text-[#2E7D32]',
  bad: 'bg-[#FFEBEE] text-[#C62828]',
};

function formatJakartaTime(at: Date): string {
  return `${at.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' })} WIB`;
}

/**
 * Where the payment provider sends a Volunteer back after paying the Trip Fee or
 * backing out (ticket 99). Opened by the signed token in the URL alone, so it
 * works whether or not the browser still has a session; it never reads one and
 * shows nothing about the Volunteer -- only the Trip, the Batch dates, the amount
 * and the Payment status the database holds. The provider's redirect proves
 * nothing; only the signed webhook settles a Payment.
 */
export default async function RegistrationResultPage({ params, searchParams }: RegistrationResultPageProps) {
  const { token } = await params;
  const { batal } = await searchParams;

  const now = new Date();
  // Checked before any database read: a guessed or tampered token costs one HMAC.
  const registrationId = verifyRegistrationResultToken(token, now.getTime());
  if (!registrationId) notFound();

  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: {
      id: true,
      batch: {
        select: {
          startDate: true,
          endDate: true,
          trip: { select: { slug: true, title: true, tripFeeAmount: true } },
        },
      },
      payment: {
        select: {
          amount: true,
          status: true,
          expiresAt: true,
          redirectUrl: true,
          vaNumber: true,
          method: true,
          providerRef: true,
          paidAt: true,
          createdAt: true,
        },
      },
    },
  });
  if (!registration) notFound();

  const { payment, batch } = registration;
  const status: PaymentStatus | 'NONE' = payment?.status ?? 'NONE';
  const copy = COPY[status];
  const transaction = payment ? transactionDetails([payment]) : null;
  // The open charge's own link, only while it is still open.
  const open = payment?.status === 'PENDING' && (payment.expiresAt === null || payment.expiresAt > now);
  const continueUrl = open ? safePaymentLink(payment.redirectUrl) : null;
  const vaNumber = open ? payment.vaNumber : null;
  const cancelled = batal === '1' && status !== 'PAID' && status !== 'REFUNDED';

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <p className="text-white text-lg font-semibold">Status Pembayaran</p>
      </div>

      <div className="px-4 mt-4 space-y-3">
        <div className="rounded-xl bg-white p-4 shadow-xs">
          <p className="text-text-secondary text-xs">Trip Fee untuk</p>
          <Link href={`/volunteer-trip/${batch.trip.slug}`} className="text-text text-sm font-semibold hover:underline">
            {batch.trip.title}
          </Link>
          <p className="mt-1 text-text-secondary text-xs">
            Batch {formatWibDate(batch.startDate)} - {formatWibDate(batch.endDate)}
          </p>
          <p className="mt-2 text-[#0073E6] text-base font-bold">{formatRupiah(payment?.amount ?? batch.trip.tripFeeAmount)}</p>
        </div>

        {cancelled && (
          <p className="rounded-xl bg-[#E3F2FD] p-4 text-sm text-text">Anda keluar dari halaman pembayaran sebelum selesai.</p>
        )}

        <div className={`rounded-xl p-4 ${TONE_CLASS[copy.tone]}`}>
          <h1 className="text-base font-semibold">{copy.title}</h1>
          <p className="mt-1 text-sm">{copy.body}</p>
        </div>

        {transaction && (
          <dl className="rounded-xl bg-white p-4 shadow-xs space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">Nomor referensi</dt>
              <dd className="font-mono text-text break-all text-right">{transaction.reference}</dd>
            </div>
            {transaction.methodLabel && (
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Metode pembayaran</dt>
                <dd className="text-text text-right">{transaction.methodLabel}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">{transaction.paid ? 'Waktu pembayaran' : 'Waktu transaksi'}</dt>
              <dd className="text-text text-right">{formatJakartaTime(transaction.at)}</dd>
            </div>
          </dl>
        )}

        {vaNumber && (
          <div className="rounded-xl bg-white p-4 shadow-xs">
            <p className="text-text-secondary text-xs">Nomor Virtual Account</p>
            <p className="mt-1 font-mono text-base font-semibold text-text">{vaNumber}</p>
          </div>
        )}

        {continueUrl && (
          <a
            href={continueUrl}
            rel="noopener noreferrer"
            className="block rounded-xl bg-[#0073E6] p-3 text-center text-sm font-semibold text-white"
          >
            Lanjutkan pembayaran
          </a>
        )}

        <Link
          href={`/volunteer-trip/registrasi/${registration.id}`}
          className="block text-center text-sm font-medium text-[#0073E6] hover:underline"
        >
          Lihat registrasi saya
        </Link>
      </div>
    </div>
  );
}
