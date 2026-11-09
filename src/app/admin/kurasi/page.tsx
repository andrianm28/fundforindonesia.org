import { prisma } from '@/lib/prisma';
import { AdminHomeCuration, type CurationItem } from '@/components/admin/AdminHomeCuration';
import { listCuration, type CuratedCampaign } from '@/lib/home-curation';
import { publicPrayerWhere } from '@/lib/prayer-moderation';

export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });

function markedNote(by: string | null, at: Date, extra = ''): string {
  return `${extra}Ditandai oleh ${by ?? 'akun yang sudah tidak ada'}, ${dateFormat.format(at)}`;
}

/**
 * Kurasi beranda (PKS pemenuhan 15): the Admin marks Campaigns "Pilihan" and
 * "Unggulan kategori", and Prayers for "Sorotan doa", in a manual order. The
 * ADMIN-only layout gives everyone else a 404; the saves go through
 * /api/admin/kurasi.
 */
export default async function AdminKurasiPage() {
  const [overview, campaigns, prayers, categoryRows] = await Promise.all([
    listCuration(prisma),
    prisma.campaign.findMany({
      where: { lifecycleStatus: 'ACTIVE' },
      select: { id: true, title: true, category: true },
      orderBy: { title: 'asc' },
      take: 300,
    }),
    // Prayers a visitor can see today; one already marked stays on its slot
    // below even after a moderator hides it.
    prisma.prayer.findMany({
      where: publicPrayerWhere(),
      select: { id: true, text: true, campaign: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.category.findMany({ select: { slug: true } }),
  ]);
  const knownCategories = new Set(categoryRows.map((c) => c.slug));

  const campaignItem = (c: CuratedCampaign): CurationItem => ({
    id: c.id,
    label: `${c.title} (${c.category})`,
    detail: markedNote(c.markedByName, c.markedAt, c.status === 'ACTIVE' ? '' : `Belum tampil di beranda (status ${c.status}). `),
  });
  // Unggulan sections are built from the Category table; a Campaign whose
  // category has no row there would silently never show.
  const unggulanItem = (c: CuratedCampaign): CurationItem => {
    const item = campaignItem(c);
    return knownCategories.has(c.category)
      ? item
      : { ...item, detail: `Kategori "${c.category}" belum terdaftar, tidak akan tampil di bagian Unggulan. ${item.detail}` };
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Kurasi Beranda</h1>
        <p className="mt-1 text-gray-600">
          Tandai Campaign dan doa untuk beranda dan atur urutannya. Penandaan tidak membuka Campaign yang belum aktif atau
          doa yang disembunyikan.
        </p>
      </div>
      <AdminHomeCuration
        pilihan={overview.pilihan.map(campaignItem)}
        unggulan={overview.unggulan.map(unggulanItem)}
        sorotan={overview.sorotan.map((p) => ({
          id: p.id,
          label: p.text,
          detail: markedNote(p.markedByName, p.markedAt, p.hidden ? 'Disembunyikan moderator, tidak tampil. ' : ''),
        }))}
        campaignOptions={campaigns.map((c) => ({ id: c.id, label: `${c.title} (${c.category})`, detail: '' }))}
        prayerOptions={prayers.map((p) => ({ id: p.id, label: `${p.text.slice(0, 80)} (${p.campaign.title})`, detail: '' }))}
      />
    </div>
  );
}
