import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';
import type { MailMessage } from './types';

/**
 * The Receipt email (CONTEXT.md, Receipt): sent to the Donor once their
 * Donation Settles. Names the Collecting Entity as who received the money
 * (prd-compliance 21) -- never this platform, which only carries it there.
 * Reaches the Donor whether or not they chose to appear anonymous on the
 * Campaign page: that hides their name from the public, not from their own
 * proof of what they gave.
 */
export type ReceiptEmailInput = {
  to: string;
  donorName: string | null;
  campaignTitle: string;
  collectingEntityName: string;
  amount: number;
  paidAt: Date;
  printUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type ReceiptRecipient = {
  recipientEmail: string;
  donorName: string | null;
  collectingEntityName: string;
};

/**
 * Who a Receipt email goes to and what it names as recipient of the money --
 * the one place both the settlement webhook and the resend endpoint decide
 * this, so the fallback order (a registered Donor's account email over a
 * Guest Donor's plaintext one) has exactly one definition. Refuses rather
 * than guessing when either is missing, naming which.
 */
export function resolveReceiptRecipient(input: {
  // Null, not absent: an address comes out of a ciphertext, and one that will
  // not decrypt is a real answer that the fallback below should see rather than
  // a field the caller forgot.
  donor: { email: string | null; name: string } | null;
  guestEmail: string | null;
  guestName: string | null;
  collectingEntityName: string | null;
}): { ok: true; recipient: ReceiptRecipient } | { ok: false; reason: string } {
  const recipientEmail = input.donor?.email ?? input.guestEmail ?? null;
  if (!recipientEmail) return { ok: false, reason: 'no recipient email on the Donation' };
  if (!input.collectingEntityName) return { ok: false, reason: 'Campaign has no Collecting Entity' };
  return {
    ok: true,
    recipient: {
      recipientEmail,
      donorName: input.donor?.name ?? input.guestName ?? null,
      collectingEntityName: input.collectingEntityName,
    },
  };
}

export function receiptEmail(input: ReceiptEmailInput): MailMessage {
  const subject = `Bukti Donasi untuk "${input.campaignTitle}"`;
  const greeting = input.donorName ? `Halo ${input.donorName},` : 'Halo,';
  const body = [
    `Terima kasih atas donasi Anda sebesar ${formatRupiah(input.amount)} pada ${formatIndonesianDate(input.paidAt)} untuk Campaign "${input.campaignTitle}".`,
    `Dana ini diterima oleh ${input.collectingEntityName}.`,
    'Bukti donasi ini dapat dibuka dan dicetak kembali kapan saja lewat tautan berikut:',
  ];
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, ...body, input.printUrl, closing].join('\n\n');
  const url = escapeHtml(input.printUrl);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return { to: input.to, subject, text, html };
}
