import { Metadata } from 'next';
import { LEGAL_DOCS_UPDATED, SITE_IDENTITY } from '@/lib/site-identity';

export const metadata: Metadata = {
  title: 'Kebijakan Privasi - Fund for Indonesia',
  description:
    'Kebijakan privasi Fund for Indonesia. Pelajari bagaimana kami mengumpulkan, menggunakan, dan melindungi data pribadi Anda.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-text mb-3">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  const mailto = (
    <a href={`mailto:${SITE_IDENTITY.privacyEmail}`} className="text-primary hover:underline">
      {SITE_IDENTITY.privacyEmail}
    </a>
  );

  return (
    <article className="prose prose-sm max-w-none">
      <h1 className="text-2xl font-bold text-text mb-6 not-prose">Kebijakan Privasi</h1>
      <p
        role="note"
        data-testid="legal-draft-notice"
        className="not-prose mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
      >
        Versi draf, menunggu tinjauan penasihat hukum
      </p>
      <p className="text-text-secondary text-sm mb-6 not-prose">
        Terakhir diperbarui: {LEGAL_DOCS_UPDATED}
      </p>

      <div className="space-y-6 text-text-secondary text-sm leading-relaxed">
        <Section title="1. Pendahuluan">
          <p>
            {SITE_IDENTITY.operatorName} (&quot;Kami&quot;), penyelenggara platform {SITE_IDENTITY.brandName} dan
            Pengendali Data Pribadi, berkomitmen melindungi data pribadi Anda sesuai UU No. 27 Tahun
            2022 tentang Pelindungan Data Pribadi (&quot;UU PDP&quot;). Kebijakan ini menjelaskan data apa yang
            benar-benar kami kumpulkan, untuk apa, berapa lama disimpan, kepada siapa dibagikan, dan hak Anda.
            Dengan menggunakan layanan kami, Anda menyetujui praktik yang dijelaskan di sini.
          </p>
        </Section>

        <Section title="2. Data yang Kami Kumpulkan">
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Akun:</strong> nama, alamat email, nomor telepon (bila diisi), foto profil, dan kata sandi
              (disimpan sebagai hash). Bila Anda masuk dengan Google, kami menerima nama, email, dan foto profil
              akun Google Anda.
            </li>
            <li>
              <strong>Donatur Tamu:</strong> nama, email, dan nomor telepon yang Anda isi saat berdonasi tanpa
              akun, hanya untuk mengirim tanda terima.
            </li>
            <li>
              <strong>Donasi dan transaksi:</strong> nominal, metode dan status pembayaran, pesan atau doa yang
              Anda tulis, pilihan donasi anonim, serta sumber tautan tempat Anda datang bila ada.
            </li>
            <li>
              <strong>Rekening bank:</strong> data rekening Penggalang Dana atau Lembaga Mitra untuk pencairan
              dana, dan data rekening Donatur bila meminta pengembalian dana. Nomor rekening disimpan
              terenkripsi.
            </li>
            <li>
              <strong>Volunteer Trip:</strong> data pendaftaran peserta (akun, batch, status pendaftaran,
              kehadiran, dan sertifikat keikutsertaan).
            </li>
            <li>
              <strong>Kolaborasi CSR:</strong> nama perusahaan, nama dan kontak (email, telepon), serta kebutuhan
              yang ditulis pengaju pertanyaan kemitraan.
            </li>
            <li>
              <strong>Konten Kampanye:</strong> judul, cerita, gambar, nama penerima manfaat, dan kabar terbaru
              yang dipublikasikan Penggalang Dana.
            </li>
            <li>
              <strong>Data teknis:</strong> alamat IP, jenis browser, dan waktu akses pada log server untuk
              keamanan dan pencegahan penyalahgunaan. Pembatas laju permintaan menyimpan penanda IP atau akun
              dalam bentuk hash, bukan alamat aslinya.
            </li>
          </ul>
          <p className="mt-2">
            Kami tidak mengumpulkan dan tidak menyimpan nomor atau salinan dokumen identitas pengguna di
            Platform. Pemeriksaan identitas, bila diperlukan, dilakukan di luar Platform.
          </p>
        </Section>

        <Section title="3. Penggunaan Data">
          <ul className="list-disc pl-5 space-y-2">
            <li>Menyediakan dan memelihara layanan Platform, termasuk akun dan sesi masuk</li>
            <li>Memproses donasi, tanda terima, pencairan dana, dan pengembalian dana</li>
            <li>Meninjau Kampanye dan Lembaga Mitra oleh Verifier sebelum tayang</li>
            <li>Mengirim email tanda terima dan notifikasi terkait akun dan Kampanye</li>
            <li>Mencegah penipuan dan menjaga keamanan Platform</li>
            <li>Memenuhi kewajiban hukum, pembukuan, dan audit</li>
          </ul>
        </Section>

        <Section title="4. Penyimpanan dan Keamanan">
          <p>
            Kata sandi disimpan sebagai hash. Email, nomor telepon, dan nomor rekening bank disimpan
            terenkripsi pada tingkat kolom, dan data dikirim melalui TLS. Kami menerapkan langkah teknis dan
            organisasi yang wajar untuk melindungi data dari akses, perubahan, pengungkapan, atau penghancuran
            yang tidak sah. Tidak ada metode transmisi atau penyimpanan yang sepenuhnya bebas risiko. Staf
            Platform yang berwenang (Admin) dapat melihat data kontak yang diperlukan untuk menjalankan tugasnya.
          </p>
        </Section>

        <Section title="5. Pembagian Data">
          <p>Kami tidak menjual data pribadi Anda. Data dapat dibagikan kepada:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>
              <strong>Pemroses Data</strong> yang membantu kami menjalankan layanan (lihat bagian 6).
            </li>
            <li>
              <strong>Lembaga Mitra dan Penggalang Dana:</strong> nama Donatur ditampilkan pada halaman Kampanye
              kecuali Anda memilih anonim. Kontak Donatur Tamu tidak ditampilkan kepada publik maupun kepada
              Penggalang Dana.
            </li>
            <li>
              <strong>Otoritas yang berwenang:</strong> bila diwajibkan oleh hukum, proses hukum, atau permintaan
              resmi pemerintah.
            </li>
          </ul>
        </Section>

        <Section title="6. Pemroses Data">
          <p>Pihak ketiga yang memproses data atas nama kami:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>
              <strong>Sumopod (penyedia layanan pembayaran):</strong> memproses pembayaran donasi dan pencairan
              dana; menerima nominal, referensi donasi, dan data yang diperlukan untuk pembayaran.
            </li>
            <li>
              <strong>Penyedia layanan email (SMTP):</strong> mengirim tanda terima, tautan konfirmasi, dan
              notifikasi; menerima alamat email penerima dan isi pesan.
            </li>
            <li>
              <strong>Penyedia hosting dan infrastruktur server:</strong> menyimpan basis data dan berkas yang
              diunggah, serta menjalankan aplikasi.
            </li>
            <li>
              <strong>Google:</strong> hanya bila Anda memilih masuk dengan Google; Google memproses proses
              masuk Anda dan memberikan nama, email, dan foto profil kepada kami.
            </li>
          </ul>
          <p className="mt-2">
            Kami meminta pemroses data menggunakan data hanya untuk tujuan layanan dan menjaga
            keamanannya. Daftar ini dapat berubah; perubahan material diumumkan sesuai bagian 13.
          </p>
        </Section>

        <Section title="7. Transfer Data Lintas Negara">
          <p>
            Sebagian pemroses data (misalnya Google, atau penyedia email dan hosting) dapat memproses atau
            menyimpan data di luar wilayah Indonesia. Bila data dikirim ke luar Indonesia, kami berupaya
            memastikan negara tujuan memiliki tingkat pelindungan data pribadi yang setara atau lebih tinggi,
            atau pemroses terikat perjanjian yang menjamin pelindungan memadai, sebagaimana diatur UU PDP.
          </p>
        </Section>

        <Section title="8. Cookie">
          <p>
            Kami memakai cookie sesi untuk menjaga login Anda. Anda dapat mengatur browser untuk menolak
            cookie, namun Anda tidak dapat masuk tanpanya.
          </p>
        </Section>

        <Section title="9. Hak Anda sebagai Subjek Data">
          <p>Sesuai UU PDP, Anda berhak:</p>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>
              <strong>Mengakses dan memperoleh salinan data Anda.</strong> Pengguna terdaftar dapat memakai
              tombol &quot;Unduh data saya&quot; di halaman Akun (profil, donasi, galang dana, dan penugasan
              dalam format JSON). Donatur Tamu dapat meminta lewat email.
            </li>
            <li>
              <strong>Memperbaiki data</strong> yang tidak akurat; profil dapat diubah di Pengaturan.
            </li>
            <li>
              <strong>Menganonimkan identitas pada donasi.</strong> Pengguna terdaftar dapat melakukannya di
              Pengaturan; Donatur Tamu lewat tautan pada tanda terima. Nama, email, telepon, dan tautan ke akun
              dihapus dari donasi tersebut, nominal dan catatan keuangan tetap.
            </li>
            <li>
              <strong>Meminta penghapusan akun dan data.</strong> Gunakan bagian &quot;Minta hapus akun&quot; di
              halaman Akun atau kirim email ke {mailto}. Permintaan diproses secara manual; belum ada
              penghapusan akun otomatis.
            </li>
            <li>Menarik persetujuan atas pemrosesan data, dan mengajukan keberatan atas pemrosesan tertentu.</li>
            <li>Mengajukan keluhan kepada lembaga pelindungan data pribadi yang berwenang.</li>
          </ul>
          <p className="mt-2">
            Kami akan menanggapi permintaan dalam jangka waktu yang ditentukan peraturan perundang-undangan.
            Kami dapat meminta bukti bahwa Anda pemilik akun sebelum memproses permintaan. Hak ini dapat
            dibatasi oleh kewajiban hukum, termasuk penyimpanan catatan keuangan (bagian 10).
          </p>
        </Section>

        <Section title="10. Retensi Data">
          <p>
            Data akun disimpan selama akun aktif atau selama diperlukan untuk layanan. Catatan keuangan (donasi,
            pembayaran, tanda terima, buku besar, pencairan, dan pengembalian dana) disimpan selama 10 tahun
            sesuai kewajiban pembukuan dan hukum. Bila Anda meminta penghapusan akun atau data, catatan
            keuangan tetap disimpan; kami dapat menganonimkan data pribadi pada catatan tersebut (nama, email,
            telepon, dan tautan ke akun) tanpa mengubah nominal atau jurnalnya. Kampanye yang pernah tayang
            tidak dihapus dari arsip Platform.
          </p>
        </Section>

        <Section title="11. Pemberitahuan Kebocoran Data">
          <p>
            Bila terjadi kegagalan pelindungan data pribadi, kami akan memberitahu subjek data yang terdampak
            dan lembaga pelindungan data pribadi secara tertulis paling lambat 3 x 24 jam setelah kami
            mengetahui kegagalan tersebut, memuat data yang terungkap, waktu dan penyebabnya, serta langkah
            penanganan, sebagaimana diwajibkan UU PDP.
          </p>
        </Section>

        <Section title="12. Anak">
          <p>
            Platform tidak ditujukan bagi anak di bawah umur untuk membuat akun sendiri. Bila Anda mengetahui
            data seorang anak diberikan tanpa persetujuan orang tua atau wali, hubungi kami agar kami dapat
            menanganinya.
          </p>
        </Section>

        <Section title="13. Perubahan Kebijakan">
          <p>
            Kebijakan ini dapat diperbarui. Perubahan material diberitahukan melalui email atau pemberitahuan
            di Platform sebelum berlaku. Tanggal pembaruan terakhir tertera di bagian atas halaman.
          </p>
        </Section>

        <Section title="14. Kontak">
          <p>
            Pertanyaan tentang kebijakan ini, permintaan hak subjek data, dan laporan insiden data pribadi:
          </p>
          <div className="mt-2">
            <p>{SITE_IDENTITY.operatorName} (Pengendali Data Pribadi)</p>
            <p>Email: {mailto}</p>
          </div>
        </Section>
      </div>
    </article>
  );
}
