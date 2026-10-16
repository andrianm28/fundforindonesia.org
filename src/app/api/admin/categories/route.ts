import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { parseNewCategory } from '@/lib/categories';

/**
 * The Admin's Category list (PRD: "Category Campaign dikelola Admin dari
 * panel"). ADMIN only, and anyone else gets the 404 of a route that does not
 * exist (ticket 90).
 *
 *   GET   -> { categories: [{ id, name, slug, icon, order, campaignCount }] }
 *   POST  { name, slug, icon, order? } -> 201 { category }; 409 on a taken
 *         slug or name. The slug is a-z, 0-9 and hyphens, and fixed once made.
 *
 * `campaignCount` is how many Campaigns name the slug: it says which
 * Categories cannot be deleted (see [id]/route.ts).
 */
export const GET = withHiddenAssignmentCheck(Assignment.ADMIN, async () => {
  const [rows, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    prisma.campaign.groupBy({ by: ['category'], _count: { _all: true } }),
  ]);
  const used = new Map(counts.map((c) => [c.category, c._count._all]));
  return NextResponse.json({
    categories: rows.map((c) => ({ ...c, campaignCount: used.get(c.slug) ?? 0 })),
  });
});

export const POST = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const parsed = parseNewCategory(await req.json().catch(() => undefined));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const taken = await prisma.category.findFirst({
    where: { OR: [{ slug: parsed.value.slug }, { name: parsed.value.name }] },
    select: { slug: true },
  });
  if (taken) {
    return NextResponse.json(
      { error: taken.slug === parsed.value.slug ? 'Slug sudah dipakai kategori lain.' : 'Nama kategori sudah dipakai.' },
      { status: 409 }
    );
  }

  const category = await prisma.category.create({ data: parsed.value });
  return NextResponse.json({ category }, { status: 201 });
});
