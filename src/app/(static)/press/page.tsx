import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Media - Fund for Indonesia',
  description: 'Pusat media Fund for Indonesia. Informasi kontak untuk keperluan liputan media.',
};

export default function PressPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Media</h1>
      <div className="space-y-6 text-text-secondary leading-relaxed">
        <p>
          Fund for Indonesia adalah platform social impact yang dioperasikan PT Jaya Korpora
          Prima. Halaman ini menjadi titik kontak bagi rekan media yang ingin meliput
          platform dan program yang berjalan di atasnya.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">Siaran Pers</h2>
          <p>
            Belum ada siaran pers yang diterbitkan. Halaman ini akan diperbarui saat siaran
            pers pertama tersedia.
          </p>
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
