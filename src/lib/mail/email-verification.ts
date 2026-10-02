import { escapeHtml } from './escape-html';
import type { MailMessage } from './types';

/**
 * The confirmation link for an account's own email address (prd-compliance
 * 23). Opening it is the only thing that proves the address is the account
 * holder's, and so the only thing that lets the account claim a Guest Donor's
 * history under that address.
 */
export type EmailVerificationEmailInput = {
  to: string;
  name: string;
  confirmUrl: string;
};

export function emailVerificationEmail(input: EmailVerificationEmailInput): MailMessage {
  const subject = 'Konfirmasi email akun Fund for Indonesia';
  const greeting = `Halo ${input.name},`;
  const body = [
    'Buka tautan berikut untuk mengonfirmasi bahwa email ini milik Anda. Setelah itu, donasi yang pernah Anda berikan sebagai tamu dengan email ini muncul di riwayat donasi akun Anda.',
    'Tautan berlaku 24 jam dan hanya bisa dipakai sekali. Jika Anda tidak meminta ini, abaikan email ini; tidak ada yang berubah.',
  ];
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, ...body, input.confirmUrl, closing].join('\n\n');
  const url = escapeHtml(input.confirmUrl);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return { to: input.to, subject, text, html };
}
