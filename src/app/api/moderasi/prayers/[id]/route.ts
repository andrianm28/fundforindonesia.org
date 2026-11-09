import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { moderatePrayer, PRAYER_MODERATION_ACTIONS } from '@/lib/prayer-moderation';
import { prayerModerationRoute } from '@/lib/prayer-moderation-route';

const bodySchema = z.object({ action: z.enum(PRAYER_MODERATION_ACTIONS) });

/**
 * PATCH /api/moderasi/prayers/[id] {action: "hide" | "show" | "delete"} -- a
 * Verifier or an Admin hides a Prayer, shows it again, or deletes it (soft),
 * recorded with who and when (PKS Pasal 3.7c). 404 for anyone who is neither,
 * and for a Prayer that does not exist; 409 for one already deleted.
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
    return NextResponse.json({ id, action: parsed.data.action });
  },
);
