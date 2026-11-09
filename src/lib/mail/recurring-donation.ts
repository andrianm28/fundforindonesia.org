import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';
import { emailLogoHtml } from './email-logo';
import { escapeHtml } from './escape-html';
import { greetingFor, oneLine } from './letter';
import type { MailMessage } from './types';

/**
 * The bill email for one cycle of a recurring donation (PKS pasal 4.7): the
 * amount, where it goes, the payment link, and the signed link that stops the
 * recurring donation without a login. Nothing was charged: the Donor pays or
 * does not, and the copy says so.
 */
export type RecurringDonationBillEmailInput = {
  to: string;
  donorName: string | null;
  campaignTitle: string;
  amount: number;
  dueDate: Date;
  payUrl: string;
  /** When the payment link stops working; null when the provider gave none. */
  payBefore: Date | null;
  stopUrl: string;
};

export function recurringDonationBillEmail(input: RecurringDonationBillEmailInput): MailMessage {
  const subject = oneLine(`Tagihan donasi rutin ${formatRupiah(input.amount)} untuk "${input.campaignTitle}"`);
  const greeting = greetingFor(input.donorName);
  const intro = `Donasi rutin Anda sebesar ${formatRupiah(input.amount)} untuk "${input.campaignTitle}" jatuh tempo ${formatIndonesianDate(input.dueDate)}. Belum ada dana yang dipotong: donasi ini baru tercatat bila Anda membayar lewat tautan di bawah.`;
  const expiry = input.payBefore ? `Tautan pembayaran berlaku sampai ${formatIndonesianDate(input.payBefore)}.` : null;
  const payLead = 'Bayar donasi:';
  const stopLead = 'Tidak ingin lagi menerima tagihan ini? Hentikan donasi rutin tanpa perlu masuk akun:';
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, intro, ...(expiry ? [expiry] : []), `${payLead}\n${input.payUrl}`, `${stopLead}\n${input.stopUrl}`, closing].join('\n\n');
  const link = (url: string) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  const html = [
    emailLogoHtml(),
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    ...(expiry ? [`<p>${escapeHtml(expiry)}</p>`] : []),
    `<p>${escapeHtml(payLead)}<br>${link(input.payUrl)}</p>`,
    `<p>${escapeHtml(stopLead)}<br>${link(input.stopUrl)}</p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');
  return { to: input.to, subject, text, html };
}
