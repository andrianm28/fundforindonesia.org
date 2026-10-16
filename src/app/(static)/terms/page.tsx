import { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL_DOCS_UPDATED, SITE_IDENTITY } from '@/lib/site-identity';

export const metadata: Metadata = {
  title: 'Syarat & Ketentuan - Fund for Indonesia',
  description:
    'Syarat dan ketentuan penggunaan platform Fund for Indonesia. Baca sebelum menggunakan layanan kami.',
};

export default function TermsPage() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1 className="text-2xl font-bold text-text mb-6 not-prose">Syarat & Ketentuan</h1>
      <p className="text-text-secondary text-sm mb-6 not-prose">
        Terakhir diperbarui: {LEGAL_DOCS_UPDATED}
      </p>

      <div className="space-y-6 text-text-secondary text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-text mb-3">1. Ketentuan Umum</h2>
          <p>
            Dengan mengakses dan menggunakan platform Fund for Indonesia (&quot;Platform&quot;), Anda menyetujui untuk
            terikat oleh syarat dan ketentuan ini. Platform ini dioperasikan oleh {SITE_IDENTITY.operatorName}
            (&quot;Kami&quot;), perusahaan berbentuk perseroan terbatas yang berkedudukan di Indonesia. Kami adalah
            penyelenggara Platform; Kami tidak menghimpun dana atas nama Kami sendiri (lihat bagian 5). Jika Anda tidak menyetujui syarat dan ketentuan
            ini, mohon untuk tidak menggunakan Platform kami.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">2. Definisi</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Platform:</strong> Website dan aplikasi Fund for Indonesia beserta seluruh fitur dan layanan yang tersedia di dalamnya.</li>
            <li><strong>Pengguna:</strong> Setiap orang yang mengakses atau menggunakan Platform, termasuk Donatur dan Penggalang Dana.</li>
            <li><strong>Donatur:</strong> Pengguna yang memberikan donasi melalui Platform.</li>
            <li><strong>Penggalang Dana:</strong> Pengguna yang telah terverifikasi dan membuat kampanye penggalangan dana di Platform.</li>
            <li><strong>Kampanye:</strong> Halaman penggalangan dana yang dibuat oleh Penggalang Dana untuk mengumpulkan donasi.</li>
            <li><strong>Lembaga Mitra:</strong> Yayasan atau perkumpulan yang tercatat di Platform dan menghimpun dana sebuah Kampanye berdasarkan izin penghimpunan miliknya sendiri.</li>
            <li><strong>Jenis Kampanye:</strong> Donasi, Wakaf, atau Hibah. Setiap jenis memiliki aturan pengembalian dana yang berbeda (bagian 7).</li>
            <li><strong>Verifier:</strong> Petugas manusia di pihak Kami yang meninjau Kampanye dan Lembaga Mitra sebelum tayang.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">3. Pendaftaran Akun</h2>
          <p>
            Untuk menggunakan fitur tertentu di Platform, Anda harus membuat akun dengan memberikan informasi yang
            akurat dan lengkap. Anda bertanggung jawab untuk menjaga kerahasiaan kata sandi dan semua aktivitas yang
            terjadi di akun Anda. Anda harus segera memberitahu kami jika terjadi penggunaan yang tidak sah atas akun
            Anda.
          </p>
          <p className="mt-2">
            Anda harus berusia minimal 17 tahun atau memiliki persetujuan orang tua/wali untuk menggunakan Platform
            ini. Kami berhak menangguhkan atau menghapus akun yang melanggar ketentuan ini.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">4. Penggalangan Dana</h2>
          <p>
            Setiap Kampanye ditinjau oleh Verifier sebelum tayang. Penggalang Dana perorangan tidak dapat membuka
            Kampanye Wakaf atau Hibah. Setiap kampanye
            harus memiliki tujuan yang jelas, sah, dan tidak bertentangan dengan hukum yang berlaku di Indonesia.
          </p>
          <p className="mt-2">
            Kami berhak menolak, menangguhkan, atau menghapus kampanye yang melanggar ketentuan ini, termasuk namun
            tidak terbatas pada kampanye yang mengandung informasi palsu, menyesatkan, atau bertentangan dengan norma
            kesusilaan.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">5. Lembaga yang Menghimpun Dana</h2>
          <p>
            Setiap Kampanye menyebut Lembaga Mitra yang menghimpun dananya, dan Kampanye hanya dapat menerima donasi
            bila Lembaga Mitra tersebut memegang izin penghimpunan yang masih berlaku untuk jenis Kampanye itu.
            Lembaga Mitra yang tertera pada Kampanye adalah pihak lawan Donatur atas donasi tersebut, berdasarkan
            izin penghimpunannya sendiri. {SITE_IDENTITY.operatorName} bertindak sebagai penyelenggara Platform dan
            pengelola pembayaran, bukan sebagai penghimpun dana.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">6. Donasi, Metode Pembayaran, dan Biaya</h2>
          <p>
            Donasi yang diberikan melalui Platform bersifat sukarela. Saat ini satu-satunya metode pembayaran yang
            tersedia adalah QRIS. Metode lain akan diumumkan di Platform setelah tersedia.
          </p>
          <p className="mt-2">
            Besaran biaya platform, bila ada, ditampilkan pada halaman setiap Kampanye dan dapat berbeda antar
            Kampanye. Donatur dapat melihatnya sebelum berdonasi.
          </p>
          <p className="mt-2">
            Dana yang diterima ditahan di Platform dan disalurkan kepada Penggalang Dana atau Lembaga Mitra melalui
            proses Pencairan Dana (bagian 8), tidak langsung diteruskan pada saat donasi dibayar.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">7. Pengembalian Dana</h2>
          <p>
            Bila sebuah donasi dikembalikan, Donatur menerima jumlah yang sama persis dengan yang dibayarkan. Biaya
            penyedia pembayaran ditanggung oleh Platform dan tidak dipotong dari pengembalian. Aturan menurut jenis
            Kampanye:
          </p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>
              <strong>Donasi:</strong> Donatur dapat mengajukan pengembalian dana. Permintaan ditinjau oleh Admin
              Platform.
            </li>
            <li>
              <strong>Wakaf:</strong> Tidak dapat dikembalikan, kecuali karena kegagalan teknis, yaitu salah bayar,
              bayar ganda, atau dana masuk setelah Kampanye ditutup.
            </li>
            <li>
              <strong>Hibah:</strong> Tidak dapat dikembalikan, kecuali karena kegagalan teknis yang sama dengan Wakaf.
              Bila sebuah Kampanye Hibah ditangguhkan, dananya dialihkan ke Kampanye Hibah lain dan tidak
              dikembalikan kepada Donatur. Aturan Hibah ini bersifat sementara dan dapat berubah setelah tinjauan
              penasihat syariah.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">8. Pencairan Dana</h2>
          <p>
            Penggalang Dana dapat mengajukan pencairan dana yang terkumpul ke rekening bank yang telah didaftarkan.
            Proses pencairan memerlukan waktu 1-3 hari kerja setelah permintaan disetujui. Kami berhak menunda
            pencairan jika terdapat indikasi pelanggaran atau penyelidikan yang sedang berlangsung.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">9. Larangan</h2>
          <p>Pengguna dilarang untuk:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>Membuat kampanye dengan informasi palsu atau menyesatkan</li>
            <li>Menggunakan Platform untuk kegiatan pencucian uang atau pendanaan terorisme</li>
            <li>Menyalahgunakan dana donasi untuk tujuan selain yang tercantum dalam kampanye</li>
            <li>Melakukan manipulasi atau penipuan dalam bentuk apapun</li>
            <li>Mengganggu operasional Platform atau mengakses sistem secara tidak sah</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">10. Batasan Tanggung Jawab</h2>
          <p>
            Kami menyediakan Platform &quot;sebagaimana adanya&quot; dan tidak memberikan jaminan bahwa Platform akan selalu
            tersedia tanpa gangguan. Kami tidak bertanggung jawab atas kerugian yang timbul dari penggunaan Platform,
            termasuk kerugian akibat penyalahgunaan dana oleh Penggalang Dana.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">11. Perubahan Ketentuan</h2>
          <p>
            Kami berhak mengubah syarat dan ketentuan ini sewaktu-waktu. Perubahan akan berlaku efektif setelah
            dipublikasikan di Platform. Penggunaan Platform setelah perubahan dianggap sebagai persetujuan Anda
            terhadap ketentuan yang telah diubah.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">12. Hukum yang Berlaku</h2>
          <p>
            Syarat dan ketentuan ini diatur oleh dan ditafsirkan sesuai dengan hukum Republik Indonesia. Segala
            sengketa yang timbul akan diselesaikan melalui musyawarah terlebih dahulu, dan jika tidak tercapai
            kesepakatan, akan diselesaikan melalui Badan Arbitrase Nasional Indonesia (BANI).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">13. Kontak</h2>
          <p>
            Pertanyaan tentang syarat dan ketentuan ini dapat dikirim ke{' '}
            <a href={`mailto:${SITE_IDENTITY.contactEmail}`} className="text-primary hover:underline">
              {SITE_IDENTITY.contactEmail}
            </a>
            . Pengelolaan data pribadi dijelaskan dalam{' '}
            <Link href="/privacy" className="text-primary hover:underline">Kebijakan Privasi</Link>.
          </p>
        </section>
      </div>
    </article>
  );
}
