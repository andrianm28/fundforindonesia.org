import { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { resolveSiteSettingsOrDefaults } from '@/lib/site-settings';

export const metadata: Metadata = {
  title: 'Tentang Kami - Fund for Indonesia',
  description: 'Pelajari lebih lanjut tentang Fund for Indonesia, platform penggalangan dana terpercaya yang menghubungkan donatur dengan kampanye sosial di seluruh Indonesia.',
};

export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  const { pages } = await resolveSiteSettingsOrDefaults(prisma);
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Tentang Kami</h1>
      <div className="space-y-4 text-text-secondary leading-relaxed">
        {pages.aboutParagraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </article>
  );
}
