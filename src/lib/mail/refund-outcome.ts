import { formatRupiah } from '@/lib/utils/currency';
import { SITE_IDENTITY } from '@/lib/site-identity';
import { greetingFor, letter, oneLine } from './letter';
import type { MailMessage } from './types';

/**
 * What a Donor is told once their Refund is settled one way or the other
 * (PRD §7.2; ticket rilis-1-benda/68): the money was sent back, or the
 * transfer could not be made. Never the account the money went to, and
 * never the Admin's own reason for a failure: both may carry the account
 * number, and an email is no place for it. The Donor is sent to the
 * platform's contact address instead.
 */
export type RefundOutcomeEmailInput = {
  to: string;
  donorName: string | null;
  /** The Campaign's or the Volunteer Trip's title. */
  subjectTitle: string;
  amount: number;
  outcome: 'completed' | 'failed';
};

export function refundOutcomeEmail(input: RefundOutcomeEmailInput): MailMessage {
  const title = oneLine(input.subjectTitle);
  const amount = formatRupiah(input.amount);
  const contact = `Jika ada pertanyaan, hubungi kami di ${SITE_IDENTITY.contactEmail} dengan menyebut judul "${input.subjectTitle}".`;

  if (input.outcome === 'completed') {
    return letter({
      to: input.to,
      subject: `Refund untuk "${title}" sudah ditransfer`,
      greeting: greetingFor(input.donorName),
      body: [
        `Refund sebesar ${amount} atas pembayaran Anda untuk "${input.subjectTitle}" sudah ditransfer ke rekening yang Anda berikan.`,
        'Waktu dana masuk mengikuti bank penerima, biasanya paling lambat satu hari kerja.',
        contact,
      ],
    });
  }

  return letter({
    to: input.to,
    subject: `Refund untuk "${title}" belum berhasil`,
    greeting: greetingFor(input.donorName),
    body: [
      `Transfer Refund sebesar ${amount} atas pembayaran Anda untuk "${input.subjectTitle}" belum berhasil dilakukan.`,
      'Dana Anda tidak hilang: transfernya tidak terjadi, dan Refund dapat diajukan kembali setelah data rekening tujuan dipastikan.',
      `Hubungi kami di ${SITE_IDENTITY.contactEmail} dengan menyebut judul "${input.subjectTitle}" agar kami dapat membantu.`,
    ],
  });
}
