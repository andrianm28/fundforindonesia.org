import type { Metadata } from 'next';
import { KindLanding } from '@/components/landing/KindLanding';

export const metadata: Metadata = {
  title: 'Kolaborasi CSR - Fund for Indonesia',
  description:
    'Program CSR siap kolaborasi untuk perusahaan, dikelompokkan menurut sektor Kesehatan, Pendidikan, Lingkungan, dan Inklusi Disabilitas.',
};

export default function KolaborasiCsrPage() {
  return (
    <KindLanding
      title="Kolaborasi CSR"
      intro="Perusahaan dan tim CSR dapat memilih Program yang sudah siap dikerjakan, lengkap dengan masalah, sasaran, lokasi, kegiatan, anggaran, jadwal, dan KPI, tanpa menunggu proposal dibuat dari nol."
      status="Portofolio Program sudah terbuka. Program tidak menerima sumbangan daring: kerja samanya dibicarakan langsung dengan tim kemitraan kami lewat tombol “Discuss with Our Team” di halaman setiap Program."
      sections={[
        {
          heading: 'Empat sektor',
          body: (
            <ul className="list-disc pl-5">
              <li>Kesehatan</li>
              <li>Pendidikan</li>
              <li>Lingkungan</li>
              <li>Inklusi Penyandang Disabilitas</li>
            </ul>
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
