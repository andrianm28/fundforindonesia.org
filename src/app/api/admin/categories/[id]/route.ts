import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { parseCategoryChange } from '@/lib/categories';

type Context = { params: Promise<{ id: string }> };

/**
 * One Category. ADMIN only; anyone else gets 404 (ticket 90).
 *
 *   PATCH { name?, icon?, order? } -> 200 { category }. The slug cannot be
 *         changed (Campaigns, fee and Escrow Hold overrides refer to it), so a
 *         rename changes only the label. 409 if the name is taken.
 *   DELETE -> 204. 409 while any Campaign names this Category's slug.
 */
export const PATCH = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context?: Context) => {
  const { id } = await context!.params;
  const parsed = parseCategoryChange(await req.json().catch(() => undefined));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) return NextResponse.json({ error: 'Kategori tidak ditemukan.' }, { status: 404 });

  if (parsed.value.name !== undefined && parsed.value.name !== category.name) {
    const clash = await prisma.category.findUnique({ where: { name: parsed.value.name } });
    if (clash) return NextResponse.json({ error: 'Nama kategori sudah dipakai.' }, { status: 409 });
  }

  const updated = await prisma.category.update({ where: { id }, data: parsed.value });
  return NextResponse.json({ category: updated });
});

export const DELETE = withHiddenAssignmentCheck(Assignment.ADMIN, async (_req: NextRequest, context?: Context) => {
  const { id } = await context!.params;
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) return NextResponse.json({ error: 'Kategori tidak ditemukan.' }, { status: 404 });

  const inUse = await prisma.campaign.count({ where: { category: category.slug } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: `Kategori masih dipakai ${inUse} Campaign, jadi tidak bisa dihapus.` },
      { status: 409 }
    );
  }

  await prisma.category.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
});
