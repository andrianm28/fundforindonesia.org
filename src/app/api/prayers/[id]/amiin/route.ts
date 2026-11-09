import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPublicPrayer, publicPrayerWhere } from '@/lib/prayer-moderation';
import { resolveAamiinVisitor, setAamiinCookie } from '@/lib/aamiin';
import { clientAddress } from '@/lib/client-ip';
import { guardRoute } from '@/lib/rate-limit-guard';

/**
 * Per client address per hour. A script without cookies gets a new guest id
 * per call, so the cookie alone cannot stop inflation; this bounds it. Generous
 * enough for people behind one shared address (a mosque, an office) giving
 * Aamiin to many Prayers. Fail-open: a limiter outage must not block a prayer.
 */
const AMIIN_LIMIT = 120;
const AMIIN_WINDOW_SECONDS = 60 * 60;

/** Thrown inside the transaction so everything it wrote is rolled back. */
class PrayerNoLongerPublic extends Error {}

/**
 * POST /api/prayers/[id]/amiin -- one Aamiin per (Prayer, visitor) (PKS
 * pemenuhan 15). The mark and the counter move together in one transaction:
 * the mark is inserted with ON CONFLICT DO NOTHING (`createMany` with
 * `skipDuplicates`), so two racing requests from the same visitor cannot both
 * insert it, and `amiinCount` rises only for the request whose insert took.
 * The increment is guarded by the public Prayer rule: a Prayer a moderator
 * hid or deleted meanwhile counts nothing, the mark is rolled back, and the
 * answer is the 404 of a Prayer that is gone (PKS 3.7c).
 *
 * Answers { id, amiinCount, alreadyAamiin }.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const refused = await guardRoute(
      {
        scope: 'prayer-amiin',
        subject: clientAddress(request.headers),
        limit: AMIIN_LIMIT,
        windowSeconds: AMIIN_WINDOW_SECONDS,
        onUnavailable: 'open',
      },
      { limited: 'Terlalu banyak Aamiin dari alamat ini. Coba lagi nanti.' },
    );
    if (refused) return refused;

    const { id } = await params;

    const prayer = await prisma.prayer.findUnique({
      where: { id },
      select: { id: true, hidden: true, deletedAt: true },
    });
    if (!prayer || !isPublicPrayer(prayer)) {
      return NextResponse.json({ error: 'Doa tidak ditemukan' }, { status: 404 });
    }

    const visitor = await resolveAamiinVisitor(request);

    let outcome: { amiinCount: number; alreadyAamiin: boolean };
    try {
      outcome = await prisma.$transaction(async (tx) => {
        const inserted = await tx.aamiinMark.createMany({
          data: [{ prayerId: id, marker: visitor.marker }],
          skipDuplicates: true,
        });
        if (inserted.count > 0) {
          const counted = await tx.prayer.updateMany({
            where: { id, ...publicPrayerWhere() },
            data: { amiinCount: { increment: 1 } },
          });
          if (counted.count === 0) throw new PrayerNoLongerPublic();
        }
        const current = await tx.prayer.findUniqueOrThrow({ where: { id }, select: { amiinCount: true } });
        return { amiinCount: current.amiinCount, alreadyAamiin: inserted.count === 0 };
      });
    } catch (error) {
      // P2003: the Prayer was hard-deleted between the read and the insert, so
      // the mark's foreign key has nothing to point at. Same answer as a gone Prayer.
      const fkViolation = typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2003';
      if (error instanceof PrayerNoLongerPublic || fkViolation) {
        return NextResponse.json({ error: 'Doa tidak ditemukan' }, { status: 404 });
      }
      throw error;
    }

    const response = NextResponse.json({ id, ...outcome });
    if (visitor.newCookie) setAamiinCookie(response, visitor.newCookie);
    return response;
  } catch (error) {
    console.error('Error incrementing amiin count:', error);
    return NextResponse.json({ error: 'Gagal menambahkan amiin' }, { status: 500 });
  }
}
