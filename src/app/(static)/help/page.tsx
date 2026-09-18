import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Help Center - Fund for Indonesia',
  description: 'Pusat bantuan Fund for Indonesia. Temukan jawaban untuk pertanyaan umum tentang donasi, kampanye, dan akun Anda.',
};

export default function HelpPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Help Center</h1>
      <p className="text-text-secondary mb-8">
        Temukan jawaban untuk pertanyaan Anda di bawah ini. Jika Anda membutuhkan bantuan
        lebih lanjut, jangan ragu untuk menghubungi tim support kami.
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="text-lg font-semibold text-text mb-4 flex items-center gap-2">
            <span className="text-primary">●</span> Donasi
          </h2>
          <div className="space-y-3 pl-5">
            <div className="p-4 bg-bg-secondary rounded-md">
              <h3 className="font-medium text-text">Bagaimana cara berdonasi?</h3>
              <p className="text-sm text-text-secondary mt-1">
                Pilih kampanye yang ingin Anda dukung, klik tombol &quot;Donasi Sekarang&quot;,
                masukkan jumlah donasi, lalu pilih metode pembayaran yang tersedia.
              </p>
            </div>
            <div className="p-4 bg-bg-secondary rounded-md">
              <h3 className="font-medium text-text">Apakah donasi saya aman?</h3>
              <p className="text-sm text-text-secondary mt-1">
                Ya, semua transaksi diproses melalui gateway pembayaran yang terenkripsi dan
                tersertifikasi. Dana Anda akan langsung tersalurkan ke kampanye yang dipilih.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-4 flex items-center gap-2">
            <span className="text-primary">●</span> Kampanye
          </h2>
          <div className="space-y-3 pl-5">
            <div className="p-4 bg-bg-secondary rounded-md">
              <h3 className="font-medium text-text">Bagaimana cara membuat kampanye?</h3>
              <p className="text-sm text-text-secondary mt-1">
                Anda perlu melakukan verifikasi identitas terlebih dahulu. Setelah terverifikasi,
                Anda dapat membuat kampanye melalui halaman &quot;Galang Dana&quot; di menu akun Anda.
              </p>
            </div>
            <div className="p-4 bg-bg-secondary rounded-md">
              <h3 className="font-medium text-text">Berapa lama proses verifikasi?</h3>
              <p className="text-sm text-text-secondary mt-1">
                Proses verifikasi identitas biasanya selesai secara instan setelah Anda mengisi
                data yang diperlukan dengan benar.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text mb-4 flex items-center gap-2">
            <span className="text-primary">●</span> Akun & Keamanan
          </h2>
          <div className="space-y-3 pl-5">
            <div className="p-4 bg-bg-secondary rounded-md">
              <h3 className="font-medium text-text">Bagaimana cara mengubah password?</h3>
              <p className="text-sm text-text-secondary mt-1">
                Buka halaman Pengaturan di menu akun Anda, lalu masukkan password saat ini dan
                password baru yang diinginkan pada bagian &quot;Ubah Password&quot;.
              </p>
            </div>
            <div className="p-4 bg-bg-secondary rounded-md">
              <h3 className="font-medium text-text">Bagaimana cara top up saldo?</h3>
              <p className="text-sm text-text-secondary mt-1">
                Fitur top up Kantong Donasi sedang tidak tersedia. Anda tetap bisa berdonasi
                langsung ke campaign pilihan Anda tanpa perlu top up saldo terlebih dahulu.
              </p>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
