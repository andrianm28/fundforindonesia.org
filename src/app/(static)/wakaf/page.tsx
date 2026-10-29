import type { Metadata } from 'next';
import { KindLanding } from '@/components/landing/KindLanding';
import { IconCardGrid } from '@/components/landing/IconCardGrid';
import { HealthIcon, MosqueIcon, PublicFacilityIcon, SchoolIcon } from '@/components/landing/LandingIcons';
import { WakafTanahCta } from '@/components/landing/WakafTanahCta';
import { prisma } from '@/lib/prisma';
import { resolveSiteSettingsOrDefaults } from '@/lib/site-settings';

export const metadata: Metadata = {
  title: 'Wakaf - Fund for Indonesia',
  description:
    'Wakaf untuk masjid, sekolah, fasilitas kesehatan, dan fasilitas umum, disalurkan lewat nazhir berizin. Ajukan atau konsultasikan wakaf tanah Anda bersama tim kami.',
};

// The land-wakaf buttons use the contact details an Admin sets, read per
// request like the Kontak page (the Docker build has no database).
export const dynamic = 'force-dynamic';

export default async function WakafPage() {
  const { contact } = await resolveSiteSettingsOrDefaults(prisma);

  return (
    <KindLanding
      title="Wakaf"
      intro="Wakaf tunai mengikat dana pokok untuk manfaat yang berkelanjutan. Di Fund for Indonesia, wakaf dikumpulkan lewat Campaign ber-Kind wakaf milik lembaga yang memegang izin wakaf."
      status="Wakaf belum dibuka untuk umum. Campaign wakaf baru bisa terbit setelah kami bermitra dengan nazhir berizin dan lembaganya memegang izin wakaf dari Verifier kami. Sampai itu terjadi, tidak ada Campaign wakaf yang bisa Anda danai di sini. Pengajuan dan konsultasi wakaf tanah sudah bisa Anda sampaikan; kami mencatatnya dan menindaklanjutinya bersama nazhir berizin."
      sections={[
        {
          heading: 'Empat kategori wakaf',
          body: (
            <IconCardGrid
              cards={[
                {
                  icon: <MosqueIcon />,
                  title: 'Masjid',
                  description: 'Tempat beribadah yang nyaman dan menjadi pusat kegiatan umat.',
                },
                {
                  icon: <SchoolIcon />,
                  title: 'Sekolah',
                  description: 'Ruang belajar bagi anak-anak dan generasi penerus.',
                },
                {
                  icon: <HealthIcon />,
                  title: 'Fasilitas Kesehatan',
                  description: 'Layanan kesehatan yang lebih dekat dengan masyarakat.',
                },
                {
                  icon: <PublicFacilityIcon />,
                  title: 'Fasilitas Umum',
                  description: 'Sarana bersama yang dibutuhkan dan dipakai masyarakat luas.',
                },
              ]}
            />
          ),
        },
        {
          heading: 'Akad Wakaf',
          body: (
            <p>
              Setiap pemberian wakaf disertai Akad Wakaf yang memuat nama Wakif, nominal, peruntukan,
              dan nazhir, dikirim bersama tanda terima. Wakaf tunai tidak dapat ditarik kembali, kecuali
              bila terjadi kesalahan pembayaran, pembayaran ganda, atau dana masuk setelah Campaign ditutup.
            </p>
          ),
        },
      ]}
    >
      <WakafTanahCta contact={contact} />
    </KindLanding>
  );
}
