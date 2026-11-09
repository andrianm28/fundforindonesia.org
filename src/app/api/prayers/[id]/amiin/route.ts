import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPublicPrayer, publicPrayerWhere } from '@/lib/prayer-moderation';
import { resolveAamiinVisitor, setAamiinCookie } from '@/lib/aamiin';

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
      if (error instanceof PrayerNoLongerPublic) {
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
