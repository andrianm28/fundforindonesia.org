import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Assignment, CampaignFeatureKind } from '@/generated/prisma/client';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listCuration, setCampaignFeatures, setPrayerHighlights } from '@/lib/home-curation';

const MAX_MARKS = 50;

const bodySchema = z.object({
  slot: z.enum(['PILIHAN', 'UNGGULAN_KATEGORI', 'SOROTAN_DOA']),
  ids: z.array(z.string().min(1)).max(MAX_MARKS),
});

/**
 * Admin curation of the home page (PKS pemenuhan 15). ADMIN only; anyone else
 * gets the 404 of a route that does not exist (ticket 90).
 *
 *   GET -> { pilihan, unggulan, sorotan }: every mark in its order, with who
 *          and when.
 *   PUT { slot: "PILIHAN" | "UNGGULAN_KATEGORI" | "SOROTAN_DOA", ids: [...] }
 *       sets that slot to exactly `ids`, in that order (at most 50). A mark
 *       that stays keeps its original who and when. 400 when an id names
 *       nothing. 409 when a concurrent save of the same slot collided.
 *
 * A mark does not make a Campaign or Prayer public: the home page still shows
 * only what the public rules allow.
 */
export const GET = withHiddenAssignmentCheck(Assignment.ADMIN, async () => {
  return NextResponse.json(await listCuration(prisma));
});

export const PUT = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Isi slot (PILIHAN, UNGGULAN_KATEGORI, SOROTAN_DOA) dan daftar id, paling banyak ${MAX_MARKS}.` },
      { status: 400 },
    );
  }
  const { slot, ids } = parsed.data;
  const session = await getServerSession();
  const actorId = session!.user!.id as string;
  const now = new Date();

  let outcome;
  try {
    outcome = await prisma.$transaction((tx) =>
      slot === 'SOROTAN_DOA'
        ? setPrayerHighlights(tx, { prayerIds: ids, actorId, now })
        : setCampaignFeatures(tx, {
            kind: slot === 'PILIHAN' ? CampaignFeatureKind.PILIHAN : CampaignFeatureKind.UNGGULAN_KATEGORI,
            campaignIds: ids,
            actorId,
            now,
          }),
    );
  } catch (error) {
    // Two Admins saving the same slot at once can both try to insert the same
    // mark (unique campaign+kind or prayer): the later one is refused, nothing
    // half-written (the transaction rolled back).
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002') {
      return NextResponse.json(
        { error: 'Slot ini sedang disimpan oleh Admin lain. Coba simpan lagi.' },
        { status: 409 },
      );
    }
    throw error;
  }
  if (outcome === 'UNKNOWN_ID') {
    return NextResponse.json({ error: 'Ada id yang tidak ditemukan (atau doa yang sudah dihapus).' }, { status: 400 });
  }
  return NextResponse.json({ slot, ids });
});
