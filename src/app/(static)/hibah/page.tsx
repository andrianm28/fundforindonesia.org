import type { Metadata } from 'next';
import { KindLanding } from '@/components/landing/KindLanding';

export const metadata: Metadata = {
  title: 'Hibah - Fund for Indonesia',
  description:
    'Hibah terarah untuk lembaga atau tujuan tertentu, disalurkan lewat Campaign milik lembaga yang terverifikasi dan memegang izin hibah.',
};

export default function HibahPage() {
  return (
    <KindLanding
      title="Hibah"
      intro="Hibah adalah pemberian terarah untuk lembaga atau tujuan tertentu. Ia berbeda dari wakaf, yang mengikat dana pokok selamanya."
      status="Hibah belum dibuka untuk umum. Aturan hibah di platform ini masih sementara dan menunggu tinjauan penasihat syariah, jadi belum ada Campaign hibah yang bisa Anda danai di sini."
      sections={[
        {
          heading: 'Bagaimana hibah bekerja',
          body: (
            <p>
              Hibah diberikan lewat Campaign ber-Kind hibah milik lembaga penerima yang sudah
              diverifikasi dan memegang izin hibah. Nominal, tanda terima, dan pilihan anonim sama
              seperti donasi biasa.
            </p>
          ),
        },
        {
          heading: 'Aturan dana',
          body: (
            <p>
              Aturan berikut masih sementara dan dapat berubah setelah tinjauan penasihat syariah. Biaya
              platform untuk hibah nol secara bawaan. Pengembalian dana hanya untuk kesalahan pembayaran,
              pembayaran ganda, atau dana yang masuk setelah Campaign ditutup. Bila sebuah Campaign hibah
              ditangguhkan, dananya dialihkan ke Campaign hibah lain, bukan dikembalikan.
            </p>
          ),
        },
        {
          heading: 'Lembaga penerima',
          body: (
            <p>
              Lembaga yang ingin menerima hibah lewat platform ini dapat menghubungi tim kami untuk
              proses verifikasi dan izin hibah.
            </p>
          ),
        },
      ]}
      primary={{ href: '/contact', label: 'Hubungi tim kami' }}
      secondary={{ href: '/explore/all', label: 'Lihat Campaign donasi' }}
    />
  );
}
