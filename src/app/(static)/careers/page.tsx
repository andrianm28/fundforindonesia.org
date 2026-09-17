import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Karir - Fund for Indonesia',
  description: 'Bergabunglah dengan tim Fund for Indonesia. Lihat posisi yang tersedia dan jadilah bagian dari misi kami untuk membantu sesama.',
};

export default function CareersPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Karir</h1>
      <div className="space-y-6 text-text-secondary leading-relaxed">
        <p>
          Bergabunglah dengan tim kami dan jadilah bagian dari misi untuk membantu jutaan
          orang Indonesia melalui platform penggalangan dana yang terpercaya.
        </p>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">Posisi yang Tersedia</h2>
          <div className="space-y-4">
            <div className="p-4 border border-border rounded-md">
              <h3 className="font-medium text-text">Frontend Engineer</h3>
              <p className="text-sm mt-1">Jakarta · Full-time</p>
            </div>
            <div className="p-4 border border-border rounded-md">
              <h3 className="font-medium text-text">Backend Engineer</h3>
              <p className="text-sm mt-1">Jakarta · Full-time</p>
            </div>
            <div className="p-4 border border-border rounded-md">
              <h3 className="font-medium text-text">Product Designer</h3>
              <p className="text-sm mt-1">Jakarta · Full-time</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">Mengapa Bergabung?</h2>
          <ul className="list-disc list-inside space-y-2">
            <li>Dampak sosial yang nyata untuk masyarakat Indonesia</li>
            <li>Tim yang kolaboratif dan suportif</li>
            <li>Kesempatan belajar dan berkembang</li>
            <li>Benefit kompetitif dan lingkungan kerja fleksibel</li>
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
