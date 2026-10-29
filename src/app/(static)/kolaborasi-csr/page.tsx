import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { KindLanding } from '@/components/landing/KindLanding';
import { IconCardGrid } from '@/components/landing/IconCardGrid';
import { AccessibilityIcon, HealthIcon, LeafIcon, SchoolIcon } from '@/components/landing/LandingIcons';
import { SECTORS, SECTOR_LABEL, sectorAnchor, type SectorValue } from '@/lib/programs';

export const metadata: Metadata = {
  title: 'Kolaborasi CSR - Fund for Indonesia',
  description:
    'Pilih pilar kolaborasi CSR: Kesehatan, Pendidikan, Lingkungan, atau Inklusi Penyandang Disabilitas, lalu diskusikan Program yang siap dikerjakan bersama tim kami.',
};

/**
 * The four pillars a company can collaborate on are the four CSR Sectors
 * (CONTEXT.md, Sector). What each covers is the scope the deck gives them
 * (PRD §8, Portofolio sektor CSR).
 */
const PILLAR: Record<SectorValue, { icon: ReactNode; description: string }> = {
  HEALTH: {
    icon: <HealthIcon />,
    description: 'Program kesehatan masyarakat, pemeriksaan kesehatan, dan akses layanan kesehatan.',
  },
  EDUCATION: {
    icon: <SchoolIcon />,
    description: 'Literasi, keterampilan, dukungan sekolah, dan pengembangan talenta masa depan.',
  },
  ENVIRONMENT: {
    icon: <LeafIcon />,
    description: 'Air bersih, penghijauan, konservasi, dan ekonomi sirkular.',
  },
  DISABILITY_INCLUSION: {
    icon: <AccessibilityIcon />,
    description: 'Akses, pemberdayaan, serta pendidikan dan fasilitas yang inklusif.',
  },
};

export default function KolaborasiCsrPage() {
  return (
    <KindLanding
      title="Kolaborasi CSR"
      intro="Perusahaan dan tim CSR dapat memilih Program yang sudah siap dikerjakan, lengkap dengan masalah, sasaran, lokasi, kegiatan, anggaran, jadwal, dan KPI, tanpa menunggu proposal dibuat dari nol."
      status="Portofolio Program sudah terbuka. Program tidak menerima sumbangan daring: kerja samanya dibicarakan langsung dengan tim kemitraan kami lewat tombol “Discuss with Our Team” di halaman setiap Program."
      sections={[
        {
          heading: 'Pilih pilar kolaborasi',
          body: (
            <>
              <p>Kolaborasi CSR berjalan di empat pilar program. Pilih yang sejalan dengan fokus perusahaan Anda.</p>
              <IconCardGrid
                cards={SECTORS.map((sector) => ({
                  icon: PILLAR[sector].icon,
                  title: SECTOR_LABEL[sector],
                  description: PILLAR[sector].description,
                  link: { href: `/program#${sectorAnchor(sector)}`, label: `Lihat Program ${SECTOR_LABEL[sector]}` },
                }))}
              />
            </>
          ),
        },
        {
          heading: 'Transparansi',
          body: (
            <p>
              Dana CSR yang melewati rekening platform dicatat di buku besar. Dana yang tidak pernah
              melewatinya ditampilkan sebagai angka laporan dan ditandai jelas sebagai di luar pembukuan.
            </p>
          ),
        },
      ]}
      primary={{ href: '/program', label: 'Lihat portofolio Program' }}
      secondary={{ href: '/impact', label: 'Impact & Transparansi' }}
    />
  );
}
