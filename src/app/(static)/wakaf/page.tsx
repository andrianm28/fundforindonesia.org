import type { Metadata } from 'next';
import { KindLanding } from '@/components/landing/KindLanding';

export const metadata: Metadata = {
  title: 'Wakaf - Fund for Indonesia',
  description:
    'Wakaf tunai untuk masjid, sekolah, fasilitas kesehatan, dan fasilitas umum, disalurkan lewat nazhir berizin dengan Akad Wakaf untuk setiap pemberian.',
};

export default function WakafPage() {
  return (
    <KindLanding
      title="Wakaf"
      intro="Wakaf tunai mengikat dana pokok untuk manfaat yang berkelanjutan. Di Fund for Indonesia, wakaf dikumpulkan lewat Campaign ber-Kind wakaf milik lembaga yang memegang izin wakaf."
      status="Wakaf belum dibuka untuk umum. Campaign wakaf baru bisa terbit setelah kami bermitra dengan nazhir berizin dan lembaganya memegang izin wakaf dari Verifier kami. Sampai itu terjadi, tidak ada Campaign wakaf yang bisa Anda danai di sini."
      sections={[
        {
          heading: 'Empat kategori wakaf',
          body: (
            <ul className="list-disc pl-5">
              <li>Masjid</li>
              <li>Sekolah</li>
              <li>Fasilitas kesehatan</li>
              <li>Fasilitas umum</li>
            </ul>
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
        {
          heading: 'Wakaf aset (tanah, bangunan, barang)',
          body: (
            <p>
              Wakaf non-tunai tidak lewat payment gateway. Hubungi tim kami untuk mencatat minat
              Anda; kami akan menindaklanjutinya setelah bermitra dengan nazhir berizin.
            </p>
          ),
        },
      ]}
      primary={{ href: '/contact', label: 'Hubungi tim kami' }}
      secondary={{ href: '/explore/all', label: 'Lihat Campaign donasi' }}
    />
  );
}
