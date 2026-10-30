import { formatRupiah } from '@/lib/utils/currency';
import { greetingFor, letter, oneLine } from './letter';
import type { MailMessage } from './types';

/**
 * What a Fundraiser is told as their Payout moves (PRD §7.2; ticket
 * rilis-1-benda/68): once an Admin approves it, and once a second Admin
 * records the transfer (CONTEXT.md, Payout). The destination is named by its
 * bank only: the Fundraiser knows their own account, and an email is no
 * place for its number.
 */
export type PayoutStatusEmailInput = {
  to: string;
  fundraiserName: string | null;
  /** The Campaign's or the Volunteer Trip's title. */
  subjectTitle: string;
  subjectKind: 'campaign' | 'trip';
  amount: number;
  bankCode: string;
  /** The Fundraiser's own screen for this Payout. */
  statusUrl: string;
} & ({ event: 'approved' } | { event: 'completed'; proofReference: string });

const SUBJECT_LABEL = { campaign: 'Campaign', trip: 'Volunteer Trip' } as const;

export function payoutStatusEmail(input: PayoutStatusEmailInput): MailMessage {
  const title = oneLine(input.subjectTitle);
  const subjectName = `${SUBJECT_LABEL[input.subjectKind]} "${title}"`;
  const amount = formatRupiah(input.amount);
  const bank = oneLine(input.bankCode);

  if (input.event === 'approved') {
    return letter({
      to: input.to,
      subject: `Pencairan dana "${title}" disetujui`,
      greeting: greetingFor(input.fundraiserName),
      body: [
        `Pengajuan pencairan dana (Payout) sebesar ${amount} untuk ${subjectName} telah disetujui Admin.`,
        `Dana akan ditransfer ke rekening ${bank} terverifikasi milik Anda. Admin lain akan mencatat transfernya, dan kami akan mengabari Anda lagi setelah dana terkirim.`,
        'Pantau status pencairan di tautan ini:',
      ],
      url: input.statusUrl,
    });
  }

  return letter({
    to: input.to,
    subject: `Dana "${title}" sudah ditransfer`,
    greeting: greetingFor(input.fundraiserName),
    body: [
      `Pencairan dana (Payout) sebesar ${amount} untuk ${subjectName} sudah ditransfer ke rekening ${bank} terverifikasi milik Anda.`,
      `Nomor referensi transfer: ${oneLine(input.proofReference)}`,
      ...(input.subjectKind === 'campaign'
        ? ['Kirimkan Laporan Penggunaan Dana (Usage Report) untuk pencairan ini: pencairan berikutnya pada Campaign yang sama baru bisa diajukan setelah laporannya terkirim.']
        : []),
      'Rincian pencairan ada di tautan ini:',
    ],
    url: input.statusUrl,
  });
}
