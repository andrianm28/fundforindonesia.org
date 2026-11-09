import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { moderatePrayer, PRAYER_MODERATION_ACTIONS } from '@/lib/prayer-moderation';
import { prayerModerationRoute } from '@/lib/prayer-moderation-route';

const bodySchema = z.object({ action: z.enum(PRAYER_MODERATION_ACTIONS) });

/**
 * PATCH /api/moderasi/prayers/[id] {action: "hide" | "show" | "delete"} -- a
 * Verifier or an Admin hides a Prayer, shows it again, or deletes it (soft),
 * recorded with who and when (PKS Pasal 3.7c). 404 for anyone who is neither,
 * and for a Prayer that does not exist; 409 for one already deleted or already
 * in the state asked for (hide on hidden, show on visible).
 */
export const PATCH = prayerModerationRoute(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const actorId = session!.user!.id as string;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Tindakan harus hide, show, atau delete' }, { status: 400 });
    }

    const outcome = await moderatePrayer(prisma, {
      prayerId: id,
      action: parsed.data.action,
      actorId,
      now: new Date(),
    });
    if (outcome === 'NOT_FOUND') return NextResponse.json({ error: 'Doa tidak ditemukan' }, { status: 404 });
    if (outcome === 'GONE') return NextResponse.json({ error: 'Doa ini sudah dihapus' }, { status: 409 });
    if (outcome === 'UNCHANGED') return NextResponse.json({ error: 'Doa sudah dalam keadaan itu' }, { status: 409 });
    // A change took effect: drop what Next itself cached of the places that list
    // Prayers, so they are re-read now. A CDN or browser in front keeps its
    // copy of /api/prayers until its 60 s s-maxage ends (no stale-while-
    // revalidate), the one remaining window.
    revalidatePath('/api/prayers');
    revalidatePath('/');
    revalidatePath('/campaign/[slug]', 'page');
    return NextResponse.json({ id, action: parsed.data.action });
  },
);
