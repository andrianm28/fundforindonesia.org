import { dialTarget } from '@/lib/site-settings';

const APPLY_SUBJECT = 'Pengajuan Wakaf Tanah';
const APPLY_BODY = [
  'Halo tim Fund for Indonesia,',
  '',
  'Saya ingin mengajukan wakaf tanah. Berikut data awalnya:',
  '- Nama:',
  '- Nomor WhatsApp:',
  '- Lokasi tanah (kota/kabupaten):',
  '- Perkiraan luas tanah:',
  '- Status kepemilikan (SHM/girik/lainnya):',
  '- Peruntukan yang diharapkan (masjid/sekolah/fasilitas kesehatan/fasilitas umum):',
].join('\n');
const CONSULT_TEXT = 'Halo tim Fund for Indonesia, saya ingin konsultasi tentang wakaf tanah.';

/**
 * Where the two land-wakaf buttons lead. Land wakaf never goes through the
 * payment gateway (it is not cash), so both open a conversation with the team
 * at the contact details an Admin set: applying opens an email with the
 * details we need to start, consulting opens WhatsApp, or email when no
 * WhatsApp number is set.
 */
export function wakafTanahLinks(contact: { email: string; whatsapp: string }): { apply: string; consult: string } {
  const mail = (subject: string, body?: string) =>
    `mailto:${contact.email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
  return {
    apply: mail(APPLY_SUBJECT, APPLY_BODY),
    consult:
      contact.whatsapp !== ''
        ? `https://wa.me/${dialTarget(contact.whatsapp)}?text=${encodeURIComponent(CONSULT_TEXT)}`
        : mail('Konsultasi Wakaf Tanah', CONSULT_TEXT),
  };
}

/**
 * The invitation to give land as wakaf (copy from the platform owner, Ira,
 * 2026-10-16). Recording interest only: the note under the buttons says the
 * follow-up waits for a licensed nazhir, as the page's status box does.
 */
export function WakafTanahCta({ contact }: { contact: { email: string; whatsapp: string } }) {
  const links = wakafTanahLinks(contact);
  return (
    <section aria-labelledby="wakaf-tanah" className="rounded-2xl bg-primary/5 border border-primary/20 p-6 md:p-8 mb-8">
      <h2 id="wakaf-tanah" className="text-xl font-bold text-text mb-4">
        Wakafkan Tanah Anda, Hadirkan Manfaat dan Pahala yang Terus Mengalir
      </h2>
      <div className="text-text-secondary leading-relaxed space-y-3">
        <p>
          Jadikan tanah Anda bagian dari kebaikan yang bermanfaat lintas generasi. Melalui wakaf tanah, Anda dapat
          membuka jalan bagi pembangunan masjid, sekolah, fasilitas kesehatan, dan fasilitas umum yang dibutuhkan
          masyarakat.
        </p>
        <p>
          Dari tempat beribadah yang nyaman, ruang belajar bagi anak-anak, hingga layanan kesehatan yang lebih
          dekat—tanah yang Anda wakafkan dapat menjadi awal perubahan bagi banyak kehidupan.
        </p>
        <p className="font-semibold text-text">
          Mari wujudkan warisan kebaikan melalui wakaf tanah. Semoga setiap manfaat yang dirasakan menjadi amal
          jariyah bagi Anda.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 mt-6">
        <a
          href={links.apply}
          className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Ajukan Wakaf Tanah Anda
        </a>
        <a
          href={links.consult}
          target={links.consult.startsWith('https://') ? '_blank' : undefined}
          rel={links.consult.startsWith('https://') ? 'noopener noreferrer' : undefined}
          className="inline-flex items-center rounded-lg border border-primary bg-white px-5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/5"
        >
          Konsultasi Wakaf Tanah
        </a>
      </div>
      <p className="text-xs text-text-secondary mt-4">
        Wakaf tanah tidak melalui pembayaran daring. Pengajuan Anda kami catat dan tindak lanjuti bersama nazhir
        berizin.
      </p>
    </section>
  );
}
