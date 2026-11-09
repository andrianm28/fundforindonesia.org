import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { listPrayersForModeration } from '@/lib/prayer-moderation';
import { canModeratePrayers } from '@/lib/prayer-moderation-route';
import { PrayerModerationList } from './PrayerModerationList';

const PAGE_SIZE = 50;

/**
 * The Prayer moderation screen (PKS Pasal 3.7c), one body for the Verifier's
 * page (/moderasi/doa) and the Admin's (/admin/doa), each behind its own
 * layout. It also asks for itself: anyone who is neither a Verifier nor an
 * Admin gets the 404 of a page that does not exist, and nothing is read first
 * (a layout does not re-run on a client navigation).
 */
export async function PrayerModerationScreen({
  basePath,
  searchParams,
}: {
  basePath: string;
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await getServerSession();
  if (!session?.user || !canModeratePrayers(session.user.assignments)) notFound();

  const { filter: asked } = await searchParams;
  const filter = asked === 'hidden' ? 'hidden' : 'visible';
  const { prayers, total } = await listPrayersForModeration(prisma, { filter, page: 1, limit: PAGE_SIZE });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Moderasi Doa</h1>
        <p className="text-sm text-text-secondary">
          Sembunyikan doa yang tidak pantas; doa tersembunyi hilang dari halaman Campaign dan beranda. Hapus bersifat
          tetap. Siapa dan kapan tercatat.
          {total > PAGE_SIZE && ` Menampilkan ${PAGE_SIZE} terbaru dari ${total}.`}
        </p>
      </div>
      <PrayerModerationList
        filter={filter}
        basePath={basePath}
        prayers={prayers.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          hiddenAt: p.hiddenAt ? p.hiddenAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
