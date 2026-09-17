import { Metadata } from 'next';

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
        Terakhir diperbarui: 1 Januari 2024
      </p>

      <div className="space-y-6 text-text-secondary text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-text mb-3">1. Pendahuluan</h2>
          <p>
            Fund for Indonesia (&quot;Kami&quot;) berkomitmen untuk melindungi privasi dan data pribadi Anda. Kebijakan
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
              <strong>Informasi Verifikasi:</strong> Nomor Induk Kependudukan (NIK), nama lengkap sesuai KTP,
              atau informasi organisasi untuk proses verifikasi identitas.
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
            <li>Melakukan verifikasi identitas pengguna</li>
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
              <strong>Penyedia Layanan Pembayaran:</strong> Untuk memproses transaksi donasi dan pencairan dana.
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
            Untuk menggunakan hak-hak ini, silakan hubungi kami melalui email di privacy@fundforindonesia.id.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-3">8. Retensi Data</h2>
          <p>
            Kami menyimpan data pribadi Anda selama akun Anda aktif atau selama diperlukan untuk menyediakan
            layanan. Data transaksi disimpan minimal 5 tahun sesuai dengan peraturan perpajakan dan keuangan
            yang berlaku. Setelah penghapusan akun, data pribadi akan dihapus dalam waktu 30 hari, kecuali
            jika ada kewajiban hukum untuk menyimpannya lebih lama.
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
            <p>Tim Privasi Data - Fund for Indonesia</p>
            <p>Email: privacy@fundforindonesia.id</p>
            <p>Telepon: (021) 1234-5678</p>
            <p>Alamat: Jl. Sudirman No. 123, Lantai 5, Jakarta Selatan 12190</p>
          </div>
        </section>
      </div>
    </article>
  );
}
