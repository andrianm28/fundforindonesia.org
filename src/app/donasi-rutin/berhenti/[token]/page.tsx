import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyRecurringStopToken } from '@/lib/recurring-donations/stop-token';
import { PERIOD_LABEL } from '@/lib/recurring-donations/schedule';
import { formatRupiah } from '@/lib/utils/currency';

// Read per request, and never cached: it shows live state behind a token.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Hentikan Donasi Rutin',
  robots: { index: false, follow: false },
  // The token is in this page's URL: never hand it to anything this page links to.
  referrer: 'no-referrer',
};

interface StopPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ selesai?: string | string[] }>;
}

/**
 * The page behind the stop link in a recurring-donation bill email (PKS pasal
 * 4.7). Opened by the signed token alone, no session. Showing it changes
 * nothing: a mail scanner that opens the link must not stop the donation, so
 * stopping is the button's POST (/api/donasi-rutin/berhenti/[token]).
 */
export default async function StopRecurringPage({ params, searchParams }: StopPageProps) {
  const { token } = await params;
  const { selesai } = await searchParams;

  // Before any database read: a guessed or tampered token costs one HMAC.
  const recurringId = verifyRecurringStopToken(token, Date.now());
  if (!recurringId) notFound();

  const recurring = await prisma.recurringDonation.findUnique({
    where: { id: recurringId },
    select: { amount: true, period: true, status: true, campaign: { select: { title: true } } },
  });
  if (!recurring) notFound();

  const stopped = recurring.status === 'STOPPED';
  const justStopped = stopped && selesai === '1';

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <p className="text-white text-lg font-semibold">Donasi Rutin</p>
      </div>
      <div className="px-4 mt-4 space-y-3">
        <div className="rounded-xl bg-white p-4 shadow-xs">
          <p className="text-text-secondary text-xs">Donasi rutin untuk</p>
          <p className="text-text text-sm font-semibold">{recurring.campaign.title}</p>
          <p className="mt-2 text-[#0073E6] text-base font-bold">
            {formatRupiah(recurring.amount)} <span className="text-text-secondary text-xs font-normal">{PERIOD_LABEL[recurring.period].toLowerCase()}</span>
          </p>
        </div>

        {stopped ? (
          <div className="rounded-xl bg-[#E8F5E9] p-4 text-[#2E7D32]">
            <h1 className="text-base font-semibold">{justStopped ? 'Donasi rutin dihentikan' : 'Donasi rutin ini sudah dihentikan'}</h1>
            <p className="mt-1 text-sm">Kami tidak akan menerbitkan tagihan lagi untuk donasi rutin ini. Tagihan yang sudah terbit tidak dikenai biaya bila tidak dibayar.</p>
          </div>
        ) : (
          <form method="post" action={`/api/donasi-rutin/berhenti/${token}`} className="rounded-xl bg-white p-4 shadow-xs space-y-3">
            <h1 className="text-base font-semibold text-text">Hentikan donasi rutin ini?</h1>
            <p className="text-sm text-text-secondary">Tidak ada dana yang dipotong otomatis. Setelah dihentikan, kami tidak akan mengirim tagihan lagi.</p>
            <button type="submit" className="w-full bg-danger text-white text-sm font-medium py-3 rounded-lg">
              Ya, hentikan
            </button>
          </form>
        )}

        <p className="text-center text-xs text-text-secondary">
          <Link href="/" className="hover:underline">Kembali ke beranda</Link>
        </p>
      </div>
    </div>
  );
}
