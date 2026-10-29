import { prisma } from '@/lib/prisma';
import { AdminCategoryManager } from '@/components/admin/AdminCategoryManager';

export const dynamic = 'force-dynamic';

/**
 * Kategori: the Category list a Campaign is filed under (PRD: "Category
 * Campaign dikelola Admin dari panel"). An Admin lists, adds and renames
 * Categories here, through /api/admin/categories. The create form and the
 * public Category pages read this same table. A Category that a Campaign
 * still uses cannot be deleted.
 */
export default async function AdminKategoriPage() {
  const [rows, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    prisma.campaign.groupBy({ by: ['category'], _count: { _all: true } }),
  ]);
  const used = new Map(counts.map((c) => [c.category, c._count._all]));
  const categories = rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    order: c.order,
    campaignCount: used.get(c.slug) ?? 0,
  }));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Kategori</h1>
        <p className="mt-1 text-gray-600">
          Daftar kategori yang bisa dipilih Fundraiser saat membuat Campaign. Slug tidak bisa diubah setelah dibuat.
        </p>
      </div>
      <AdminCategoryManager categories={categories} />
    </div>
  );
}
