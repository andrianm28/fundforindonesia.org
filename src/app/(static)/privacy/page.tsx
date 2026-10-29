import { Metadata } from 'next';
import { LEGAL_DOCS_UPDATED, SITE_IDENTITY } from '@/lib/site-identity';

export const metadata: Metadata = {
  title: 'Kebijakan Privasi - Fund for Indonesia',
  description:
    'Kebijakan privasi Fund for Indonesia. Pelajari bagaimana kami mengumpulkan, menggunakan, dan melindungi data pribadi Anda.',
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1 className="text-2xl font-bold text-text mb-6 not-prose">Kebijakan Privasi</h1>
      <p className="text-text-secondary text-sm mb-6 not-prose">
        Terakhir diperbarui: {LEGAL_DOCS_UPDATED}
      </p>

      <div className="space-y-6 text-text-secondary text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-text mb-3">1. Pendahuluan</h2>
          <p>
            {SITE_IDENTITY.operatorName} (&quot;Kami&quot;), penyelenggara platform Fund for Indonesia dan
            Pengendali Data Pribadi, berkomitmen untuk melindungi privasi dan data pribadi Anda. Kebijakan
            Privasi ini menjelaskan bagaimana kami mengumpulkan, menggunakan, menyimpan, dan melindungi informasi
            pribadi Anda ketika Anda menggunakan platform kami. Dengan menggunakan layanan kami, Anda menyetujui
            praktik yang dijelaskan dalam kebijakan ini.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">2. Informasi yang Kami Kumpulkan</h2>
          <p>Kami mengumpulkan informasi berikut:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>
              <strong>Informasi Akun:</strong> Nama, alamat email, kata sandi (terenkripsi), foto profil, dan
              nomor telepon yang Anda berikan saat mendaftar.
            </li>
            <li>
              <strong>Informasi Donatur Tamu:</strong> Nama, email, dan nomor telepon yang Anda isi saat berdonasi
              tanpa akun, hanya untuk mengirim tanda terima.
            </li>
            <li>
              <strong>Informasi Rekening Bank:</strong> Data rekening bank Penggalang Dana atau Lembaga Mitra
              untuk pencairan dana, serta data rekening Donatur bila meminta pengembalian dana. Nomor rekening
              disimpan terenkripsi.
            </li>
            <li>
              <strong>Informasi Volunteer Trip:</strong> Data pendaftaran peserta Volunteer Trip.
            </li>
            <li>
              <strong>Informasi Kolaborasi CSR:</strong> Nama, kontak, dan pesan dari perusahaan yang mengajukan
              pertanyaan kemitraan CSR.
            </li>
            <li>
              <strong>Doa dan Pesan:</strong> Doa yang Anda tulis pada sebuah donasi, yang dapat ditampilkan pada
              halaman Kampanye.
            </li>
            <li>
              <strong>Informasi Transaksi:</strong> Riwayat donasi, pencairan dana, metode pembayaran yang
              digunakan, dan saldo akun.
            </li>
            <li>
              <strong>Informasi Teknis:</strong> Alamat IP, jenis browser, sistem operasi, halaman yang
              dikunjungi, dan waktu akses untuk keperluan analitik dan keamanan.
            </li>
            <li>
              <strong>Informasi Kampanye:</strong> Konten kampanye yang Anda buat termasuk judul, deskripsi,
              gambar, dan pembaruan yang Anda publikasikan.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">3. Penggunaan Informasi</h2>
          <p>Kami menggunakan informasi yang dikumpulkan untuk:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>Menyediakan, memelihara, dan meningkatkan layanan Platform</li>
            <li>Memproses transaksi donasi dan pencairan dana</li>
            <li>Meninjau Kampanye dan Lembaga Mitra oleh Verifier sebelum tayang</li>
            <li>Mengirimkan notifikasi terkait aktivitas akun dan kampanye</li>
            <li>Mencegah penipuan dan menjaga keamanan Platform</li>
            <li>Mematuhi kewajiban hukum dan peraturan yang berlaku</li>
            <li>Melakukan analisis untuk meningkatkan pengalaman pengguna</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">4. Penyimpanan dan Keamanan Data</h2>
          <p>
            Kami menyimpan data pribadi Anda pada server yang aman dengan enkripsi standar industri. Kata sandi
            disimpan dalam bentuk hash menggunakan algoritma bcrypt. Data transaksi dilindungi dengan protokol
            keamanan TLS/SSL.
          </p>
          <p className="mt-2">
            Kami menerapkan langkah-langkah keamanan teknis dan organisasi yang wajar untuk melindungi data
            pribadi Anda dari akses yang tidak sah, perubahan, pengungkapan, atau penghancuran. Namun, tidak
            ada metode transmisi data melalui internet yang 100% aman.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">5. Pembagian Informasi</h2>
          <p>Kami tidak menjual data pribadi Anda kepada pihak ketiga. Kami dapat membagikan informasi Anda dengan:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>
              <strong>Sumopod (penyedia layanan pembayaran):</strong> Untuk memproses pembayaran donasi dan
              pencairan dana.
            </li>
            <li>
              <strong>Penyedia layanan email:</strong> Untuk mengirim tanda terima dan notifikasi.
            </li>
            <li>
              <strong>Google:</strong> Bila Anda memilih masuk dengan Google, Google memproses proses masuk Anda dan
              memberikan nama, email, dan foto profil akun Google Anda kepada Kami.
            </li>
            <li>
              <strong>Otoritas Hukum:</strong> Jika diwajibkan oleh hukum, proses hukum, atau permintaan
              pemerintah yang sah.
            </li>
            <li>
              <strong>Pengguna Lain:</strong> Informasi publik seperti nama dan foto profil ditampilkan pada
              halaman donasi dan kampanye (sesuai pengaturan privasi Anda).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">6. Cookie dan Teknologi Pelacakan</h2>
          <p>
            Kami menggunakan cookie dan teknologi serupa untuk meningkatkan pengalaman pengguna, menganalisis
            lalu lintas, dan menyesuaikan konten. Cookie sesi digunakan untuk menjaga sesi login Anda. Anda
            dapat mengatur browser untuk menolak cookie, namun beberapa fitur Platform mungkin tidak berfungsi
            dengan baik.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">7. Hak Pengguna</h2>
          <p>Anda memiliki hak untuk:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>Mengakses data pribadi yang kami simpan tentang Anda</li>
            <li>Memperbarui atau memperbaiki informasi pribadi yang tidak akurat</li>
            <li>Meminta penghapusan data pribadi Anda (dengan batasan tertentu)</li>
            <li>Menarik persetujuan atas pemrosesan data tertentu</li>
            <li>Mengajukan keluhan kepada otoritas perlindungan data yang berwenang</li>
          </ul>
          <p className="mt-2">
            Untuk menggunakan hak-hak ini, silakan hubungi kami melalui email di{' '}
            <a href={`mailto:${SITE_IDENTITY.privacyEmail}`} className="text-primary hover:underline">
              {SITE_IDENTITY.privacyEmail}
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">8. Retensi Data</h2>
          <p>
            Kami menyimpan data pribadi Anda selama akun Anda aktif atau selama diperlukan untuk menyediakan
            layanan. Catatan keuangan (donasi, pembayaran, pencairan, dan pengembalian dana) disimpan selama 10
            tahun sesuai kewajiban hukum. Untuk menghapus akun atau data pribadi Anda, ajukan lewat email{' '}
            {SITE_IDENTITY.privacyEmail}. Catatan keuangan tetap disimpan sesuai kewajiban hukum, tetapi data
            donasi Anda dapat dianonimkan: nama, email, nomor telepon, dan tautan ke akun Anda dihapus dari
            donasi tersebut.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">9. Perubahan Kebijakan Privasi</h2>
          <p>
            Kami dapat memperbarui Kebijakan Privasi ini dari waktu ke waktu. Perubahan material akan
            diberitahukan melalui email atau pemberitahuan di Platform sebelum berlaku efektif. Kami mendorong
            Anda untuk meninjau kebijakan ini secara berkala.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">10. Kontak</h2>
          <p>
            Jika Anda memiliki pertanyaan tentang Kebijakan Privasi ini atau praktik penanganan data kami,
            silakan hubungi:
          </p>
          <div className="mt-2">
            <p>{SITE_IDENTITY.operatorName} (Pengendali Data Pribadi)</p>
            <p>Email: {SITE_IDENTITY.privacyEmail}</p>
          </div>
        </section>
      </div>
    </article>
  );
}
