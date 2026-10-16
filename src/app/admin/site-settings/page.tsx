import { prisma } from '@/lib/prisma';
import { resolveSiteSettings, type SiteSettingKey } from '@/lib/site-settings';
import { AdminSiteSettingForm } from '@/components/admin/AdminSiteSettingForm';

export const dynamic = 'force-dynamic';

/**
 * Pengaturan Laman Publik: the content of the public pages, edited by an
 * Admin (src/lib/site-settings.ts). Each section posts to
 * POST /api/admin/site-settings. What is shown is what visitors see: a stored
 * row, or the text the page carried before it was editable. Public content
 * only; payment providers, fees and thresholds have their own screens.
 */

const SECTIONS: { key: SiteSettingKey; title: string; description: string }[] = [
  { key: 'hero', title: 'Banner beranda', description: 'Slide di bagian atas halaman beranda: gambar, judul dan tombolnya.' },
  { key: 'contact', title: 'Kontak', description: 'Halaman Kontak. Telepon atau WhatsApp yang dikosongkan tidak ditampilkan.' },
  { key: 'social', title: 'Media sosial', description: 'Tautan di footer dan halaman Kontak. Yang dikosongkan tidak ditampilkan.' },
  { key: 'footer', title: 'Footer', description: 'Paragraf pengantar di footer.' },
  { key: 'pages', title: 'Halaman Tentang Kami, Media dan Karir', description: 'Isi halaman Tentang Kami dan email kontak halaman Media dan Karir.' },
];

export default async function AdminSiteSettingsPage() {
  const settings = await resolveSiteSettings(prisma);
  const rows = await prisma.siteSetting.findMany({ include: { updatedBy: { select: { name: true } } } });
  const lastChange = new Map(rows.map((r) => [r.key, r]));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Pengaturan Laman Publik</h1>
        <p className="mt-1 text-gray-600">
          Isi dan tautan yang tampil di laman publik. Perubahan langsung terlihat pengunjung.
        </p>
      </div>
      <div className="space-y-6">
        {SECTIONS.map(({ key, title, description }) => {
          const row = lastChange.get(key);
          return (
            <section key={key} className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              <p className="mb-1 text-sm text-gray-600">{description}</p>
              <p className="mb-4 text-xs text-gray-500">
                {row
                  ? `Terakhir diubah oleh ${row.updatedBy.name}, ${new Date(row.updatedAt).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' })} WIB.`
                  : 'Belum pernah diubah: teks bawaan yang tampil.'}
              </p>
              <AdminSiteSettingForm settingKey={key} initial={settings[key] as never} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
