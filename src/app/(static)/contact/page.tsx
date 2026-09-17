import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kontak - Fund for Indonesia',
  description:
    'Hubungi tim Fund for Indonesia melalui email, telepon, atau media sosial. Kami siap membantu Anda.',
};

export default function ContactPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Kontak</h1>
      <p className="text-text-secondary mb-8">
        Punya pertanyaan atau butuh bantuan? Hubungi kami melalui salah satu cara di bawah ini.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Email */}
        <div className="border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="font-semibold text-text">Email</h2>
          </div>
          <p className="text-text-secondary text-sm mb-2">Kirim pertanyaan atau saran Anda via email.</p>
          <a href="mailto:support@fundforindonesia.id" className="text-primary text-sm font-medium hover:underline">
            support@fundforindonesia.id
          </a>
        </div>

        {/* Phone */}
        <div className="border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <h2 className="font-semibold text-text">Telepon</h2>
          </div>
          <p className="text-text-secondary text-sm mb-2">Hubungi layanan pelanggan kami (Senin-Jumat, 09:00-17:00 WIB).</p>
          <a href="tel:+622112345678" className="text-primary text-sm font-medium hover:underline">
            (021) 1234-5678
          </a>
        </div>

        {/* WhatsApp */}
        <div className="border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <h2 className="font-semibold text-text">WhatsApp</h2>
          </div>
          <p className="text-text-secondary text-sm mb-2">Chat langsung dengan tim support kami.</p>
          <a
            href="https://wa.me/622112345678"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary text-sm font-medium hover:underline"
          >
            +62 21 1234-5678
          </a>
        </div>

        {/* Social Media */}
        <div className="border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="font-semibold text-text">Media Sosial</h2>
          </div>
          <p className="text-text-secondary text-sm mb-3">Ikuti kami untuk update terbaru.</p>
          <div className="flex flex-col gap-2">
            <a
              href="https://instagram.com/fundforindonesia"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-sm font-medium hover:underline"
            >
              Instagram: @fundforindonesia
            </a>
            <a
              href="https://twitter.com/fundforid"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-sm font-medium hover:underline"
            >
              Twitter: @fundforid
            </a>
            <a
              href="https://facebook.com/fundforindonesia"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-sm font-medium hover:underline"
            >
              Facebook: Fund for Indonesia
            </a>
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="mt-8 border border-border rounded-lg p-6">
        <h2 className="font-semibold text-text mb-3">Alamat Kantor</h2>
        <p className="text-text-secondary text-sm">
          Jl. Sudirman No. 123, Lantai 5<br />
          Jakarta Selatan, DKI Jakarta 12190<br />
          Indonesia
        </p>
      </div>
    </article>
  );
}
