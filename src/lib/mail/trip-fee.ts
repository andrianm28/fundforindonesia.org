import { formatRupiah } from '@/lib/utils/currency';
import { SITE_IDENTITY } from '@/lib/site-identity';
import { formatWibDate } from '@/lib/volunteer/batch-dates';
import type { RefundTierKey } from '@/lib/volunteer/refund-table';
import { greetingFor, letter, oneLine } from './letter';
import type { MailMessage } from './types';

/**
 * What a Volunteer is told about their Trip Fee (ticket rilis-1-benda/84):
 * the Registration is confirmed once the Trip Fee settles, a Trip Fee Refund
 * is approved, and it is paid. A Refund is worded by its tier of
 * ./refund-table.ts (FULL or HALF; a NONE tier owes no Refund, so none is
 * ever opened). Never the account the money goes to, nor anything else
 * personal: the input has no field for it, and the Volunteer is sent to the
 * platform's contact address for questions.
 */
type Base = {
  to: string;
  volunteerName: string | null;
  tripTitle: string;
  tripUrl: string;
};

export type TripFeeEmailInput = Base &
  (
    | { event: 'confirmed'; amount: number; startDate: Date; endDate: Date }
    | {
        event: 'refund-approved' | 'refund-completed';
        tier: Exclude<RefundTierKey, 'NONE'>;
        /** The Refund's amount. */
        amount: number;
        /** The Trip Fee that was paid. */
        paidAmount: number;
      }
  );

export function tripFeeEmail(input: TripFeeEmailInput): MailMessage {
  const title = oneLine(input.tripTitle);
  const greeting = greetingFor(input.volunteerName);
  const contact = `Jika ada pertanyaan, hubungi kami di ${SITE_IDENTITY.contactEmail} dengan menyebut judul "${title}".`;

  if (input.event === 'confirmed') {
    return letter({
      to: input.to,
      subject: `Pendaftaran "${title}" dikonfirmasi`,
      greeting,
      body: [
        `Trip Fee sebesar ${formatRupiah(input.amount)} sudah kami terima dan pendaftaran Anda untuk "${input.tripTitle}" dikonfirmasi.`,
        `Jadwal: ${formatWibDate(input.startDate)} sampai ${formatWibDate(input.endDate)}.`,
        'Jika Anda perlu membatalkan, Refund Trip Fee mengikuti tabel refund yang ditampilkan pada halaman Trip.',
      ],
      url: input.tripUrl,
    });
  }

  const amount = formatRupiah(input.amount);
  const scope =
    input.tier === 'FULL'
      ? `sebesar ${amount} (penuh, sama dengan Trip Fee yang Anda bayar)`
      : `sebesar ${amount} (separuh dari Trip Fee ${formatRupiah(input.paidAmount)} yang Anda bayar, sesuai tabel refund)`;

  if (input.event === 'refund-approved') {
    return letter({
      to: input.to,
      subject: `Refund Trip Fee "${title}" disetujui`,
      greeting,
      body: [
        `Refund Trip Fee untuk "${input.tripTitle}" ${scope} sudah disetujui.`,
        'Transfer ke rekening yang Anda berikan sedang diproses; kami akan mengabari Anda lagi setelah dana dikirim.',
        contact,
      ],
      url: input.tripUrl,
    });
  }

  return letter({
    to: input.to,
    subject: `Refund Trip Fee "${title}" sudah ditransfer`,
    greeting,
    body: [
      `Refund Trip Fee untuk "${input.tripTitle}" ${scope} sudah ditransfer ke rekening yang Anda berikan.`,
      'Waktu dana masuk mengikuti bank penerima, biasanya paling lambat satu hari kerja.',
      contact,
    ],
    url: input.tripUrl,
  });
}
