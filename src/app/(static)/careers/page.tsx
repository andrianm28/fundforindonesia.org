import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Karir - Fund for Indonesia',
  description: 'Bergabunglah dengan tim Fund for Indonesia dan jadilah bagian dari misi kami untuk membantu sesama.',
};

export default function CareersPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Karir</h1>
      <div className="space-y-6 text-text-secondary leading-relaxed">
        <p>
          Bergabunglah dengan tim kami dan jadilah bagian dari misi untuk membantu masyarakat
          Indonesia melalui platform penggalangan dana yang terpercaya.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">Posisi yang Tersedia</h2>
          <p>
            Saat ini belum ada lowongan yang dibuka. Kami tetap terbuka untuk perkenalan,
            jadi silakan kirimkan profil Anda bila tertarik bekerja bersama kami.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">Mengapa Bergabung?</h2>
          <ul className="list-disc list-inside space-y-2">
            <li>Dampak sosial yang nyata untuk masyarakat Indonesia</li>
            <li>Tim yang kolaboratif dan suportif</li>
            <li>Kesempatan belajar dan berkembang</li>
          </ul>
        </section>

        <p className="text-sm">
          Tertarik? Kirimkan CV dan portfolio Anda ke{' '}
          <span className="text-primary font-medium">careers@fundforindonesia.org</span>
        </p>
      </div>
    </article>
  );
}
