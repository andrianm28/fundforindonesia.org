import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Media - Fund for Indonesia',
  description: 'Pusat media Fund for Indonesia. Temukan siaran pers, kit media, dan informasi kontak untuk liputan media.',
};

export default function PressPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Media</h1>
      <div className="space-y-6 text-text-secondary leading-relaxed">
        <p>
          Selamat datang di pusat media Fund for Indonesia. Di sini Anda dapat menemukan
          informasi terkini tentang platform kami, siaran pers, dan materi media untuk
          keperluan liputan.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">Siaran Pers</h2>
          <div className="space-y-3">
            <div className="p-4 border border-border rounded-md">
              <p className="text-sm text-text-secondary">15 Januari 2024</p>
              <h3 className="font-medium text-text mt-1">
                Fund for Indonesia Mencapai 1 Juta Donatur Terdaftar
              </h3>
            </div>
            <div className="p-4 border border-border rounded-md">
              <p className="text-sm text-text-secondary">3 Desember 2023</p>
              <h3 className="font-medium text-text mt-1">
                Peluncuran Fitur Verifikasi Kampanye Baru
              </h3>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">Kit Media</h2>
          <p>
            Untuk mendapatkan logo, panduan brand, dan materi visual lainnya, silakan hubungi
            tim media kami.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">Kontak Media</h2>
          <p>
            Untuk pertanyaan terkait media dan liputan, hubungi:{' '}
            <span className="text-primary font-medium">press@fundforindonesia.org</span>
          </p>
        </section>
      </div>
    </article>
  );
}
