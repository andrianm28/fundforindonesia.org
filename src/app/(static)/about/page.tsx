import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tentang Kami - Fund for Indonesia',
  description: 'Pelajari lebih lanjut tentang Fund for Indonesia, platform penggalangan dana terpercaya yang menghubungkan donatur dengan kampanye sosial di seluruh Indonesia.',
};

export default function AboutPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Tentang Kami</h1>
      <div className="space-y-4 text-text-secondary leading-relaxed">
        <p>
          Fund for Indonesia adalah platform penggalangan dana online yang didedikasikan untuk membantu
          masyarakat Indonesia dalam mengumpulkan dana untuk berbagai kebutuhan sosial, kesehatan,
          pendidikan, dan kemanusiaan. Kami percaya bahwa setiap orang memiliki kekuatan untuk
          membuat perubahan positif di lingkungan sekitarnya.
        </p>
        <p>
          Didirikan dengan visi untuk menjadi jembatan antara mereka yang membutuhkan bantuan dan
          mereka yang ingin membantu, platform kami menyediakan infrastruktur teknologi yang aman,
          transparan, dan mudah digunakan. Setiap kampanye yang terdaftar telah melalui proses
          verifikasi untuk memastikan keaslian dan akuntabilitas penggalangan dana.
        </p>
        <p>
          Kami berkomitmen untuk menjaga kepercayaan donatur dengan menerapkan standar transparansi
          tertinggi dalam pelaporan penggunaan dana, serta memberikan perlindungan menyeluruh bagi
          semua pihak yang terlibat dalam ekosistem penggalangan dana kami.
        </p>
      </div>
    </article>
  );
}
