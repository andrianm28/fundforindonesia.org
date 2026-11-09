import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { DONATIONS_DISABLED_MESSAGE } from '@/lib/donations';
import { donationsSwitchedOff, resolveDonationPresetsOrDefaults } from '@/lib/operations';
import { DonationPresetsProvider } from '@/components/donation/DonationPresetsContext';

export const dynamic = 'force-dynamic';

/**
 * The donate page is a client component that reads the build-time env switch.
 * The Admin's switch (src/lib/operations.ts) is read at request time, so it is
 * decided here: while donations are switched off the donor sees the closed
 * message at once instead of an amount form the API would refuse. The API
 * stays the authoritative gate. The Admin's preset amounts are read here too
 * and handed to the page through a context (a damaged or missing row shows the
 * defaults).
 */
export default async function DonateLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  if (await donationsSwitchedOff(prisma)) {
    const { slug } = await params;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-text-secondary">{DONATIONS_DISABLED_MESSAGE}</p>
        <Link href={`/campaign/${encodeURIComponent(slug)}`} className="text-primary font-medium hover:underline">
          Kembali
        </Link>
      </div>
    );
  }
  const presets = await resolveDonationPresetsOrDefaults(prisma);
  return <DonationPresetsProvider presets={presets}>{children}</DonationPresetsProvider>;
}
